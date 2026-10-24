// ============================================================
//  🛒 БАРАХОЛКА "У СОСЕДА" — Бояркино и окрестности
//  v5: будильник (авто-пост 19:00 МСК) ПОЛНОСТЬЮ ОТКЛЮЧЁН
// ============================================================

import { Bot, Keyboard } from "@maxhub/max-bot-api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

// ── НАСТРОЙКИ ──────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID ? Number(process.env.CHANNEL_ID) : -78241752722859;
const CHANNEL_LINK = process.env.CHANNEL_LINK || "https://max.ru/channel_usoseda";
const BOT_LINK = "https://max.ru/id772021011900_1_bot";
const SELL_LINK = `${BOT_LINK}?start=sell`;
const MAX_API = "https://platform-api2.max.ru";

// ── ХРАНИЛИЩЕ ──────────────────────────────────────────────
const STORE_FILE = new URL("./store.json", import.meta.url);
let store = { 
    nextId: 1, 
    items: [],
    activeForms: {},
    knownUsers: {}
};

if (existsSync(STORE_FILE)) {
    try {
        store = { ...store, ...JSON.parse(readFileSync(STORE_FILE, "utf8")) };
        console.log("📁 Загружено сохранение барахолки");
    } catch {
        console.warn("⚠️  store.json повреждён");
    }
}

const saveStore = () => {
    writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
};

const bot = new Bot(TOKEN);

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ────────────────────────────────
function userIdOf(ctx) {
    return ctx.user?.user_id ?? 
           ctx.callback?.user?.user_id ?? 
           ctx.message?.sender?.user_id ?? 
           ctx.from?.user_id ?? 
           null;
}

function userNameOf(ctx) {
    return ctx.user?.name ?? 
           ctx.callback?.user?.name ?? 
           ctx.message?.sender?.name ?? 
           "друг";
}

function getText(ctx) {
    if (ctx.text && typeof ctx.text === "string") return ctx.text;
    if (ctx.message?.text && typeof ctx.message.text === "string") return ctx.message.text;
    if (ctx.message?.body?.text && typeof ctx.message.body.text === "string") return ctx.message.body.text;
    if (ctx.body?.text && typeof ctx.body.text === "string") return ctx.body.text;
    return "";
}

function getPhotos(ctx) {
    const photos = [];
    if (ctx.message?.photo) photos.push(ctx.message.photo);
    if (ctx.photo) photos.push(ctx.photo);
    const sources = [ctx.message?.attachments, ctx.message?.body?.attachments, ctx.attachments];
    for (const src of sources) {
        if (Array.isArray(src)) {
            for (const a of src) {
                if (a && (a.type === "photo" || a.type === "image")) photos.push(a);
            }
        }
    }
    return photos;
}

function fmtPrice(p) {
    return p === 0 ? "🎁 Бесплатно / отдам даром" : p + " ₽";
}

function mainMenuKeyboard() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback("📢 Подать объявление", "menu:sell")],
        [Keyboard.button.callback("❓ Помощь", "menu:help")]
    ]);
}

// 🛡️ Проверка "это канал?" — чтобы бот не отвечал на СВОИ посты
function isFromChannel(ctx) {
    const chatType = ctx.chat?.type || ctx.message?.chat?.type || ctx.message?.recipient?.chat_type || ctx.callback?.message?.chat?.type;
    const chatId = ctx.chat?.chat_id || ctx.message?.chat?.chat_id || ctx.message?.recipient?.chat_id || ctx.callback?.message?.chat?.chat_id || ctx.chat?.id || ctx.message?.chat?.id;
    
    if (chatType === "channel") return true;
    if (chatId && String(chatId) === String(CHANNEL_ID)) return true;
    
    return false;
}

async function replyPrivate(ctx, uid, text, opts = {}) {
    try {
        await bot.api.sendMessageToUser(uid, text, opts);
    } catch (e) {
        if (isFromChannel(ctx)) return; // 🛡️ в канал не пишем никогда
        try {
            await ctx.reply(text, opts);
        } catch (e2) {
            console.log("⚠️  Не удалось ответить в личку: " + (e2?.message ?? e2));
        }
    }
}

// ── ТЕКСТ И КНОПКИ ПОСТА ДЛЯ КАНАЛА ────────────────────────
function buildChannelText(item) {
    return [
        "📤 Поделись объявлением с соседями!",
        "",
        `🏷️ ${item.title}`,
        `💰 Цена: ${fmtPrice(item.price)}`,
        `📝 Описание: ${item.description}`,
        `📍 Где: ${item.location}`,
        `📞 Звонить: ${item.phone}`,
        `👤 Продавец: ${item.sellerName}`,
        "",
        CHANNEL_LINK
    ].join("\n");
}

// В канале остаётся ровно одна кнопка: она сразу открывает личный диалог с ботом.
// ?start=sell сообщает боту, что посетитель хочет подать объявление.
function buildChannelButtons(item) {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.link("📢 Подать объявление", SELL_LINK)]
    ]);
}

// Подпись подтверждает право удалить именно собственный пост.
// Она хранится в личной кнопке автора в MAX и не зависит от store.json Render.
function deleteSignature(userId, postId) {
    return createHmac("sha256", TOKEN)
        .update("delete-post-v1:" + String(userId) + ":" + String(postId))
        .digest("hex").slice(0, 24);
}
function validDeleteSignature(userId, postId, signature) {
    if (!userId || !/^[a-f0-9]{24}$/.test(String(signature))) return false;
    const expected = Buffer.from(deleteSignature(userId, postId), "hex");
    const actual = Buffer.from(signature, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function deleteKeyboard(uid, mid, confirmation = false) {
    const sig = deleteSignature(uid, mid);
    return Keyboard.inlineKeyboard(confirmation
        ? [[Keyboard.button.callback("✅ Да, удалить из канала", `del:yes:${mid}:${sig}`)],
           [Keyboard.button.callback("↩️ Оставить объявление", `del:no:${mid}:${sig}`)]]
        : [[Keyboard.button.callback("🗑 Снять моё объявление", `del:ask:${mid}:${sig}`)]]
    );
}
function sentPostId(result) {
    return result?.body?.mid || result?.message?.body?.mid || result?.mid || null;
}

// ── ОТПРАВКА В КАНАЛ ───────────────────────────────────────
async function sendToChannel(text, libAttachments) {
    if (!CHANNEL_ID) {
        console.log("⚠️  Канал не подключён");
        return null;
    }

    try {
        const res = await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: libAttachments });
        console.log("📢 Опубликовано в канале (фото + кнопки)!");
        return res;
    } catch (e) {
        console.log("⚠️  С фото не вышло: " + (e?.message ?? e));
    }

    try {
        const buttonsOnly = libAttachments.filter(a => a?.type !== "photo" && a?.type !== "image");
        const res = await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: buttonsOnly });
        console.log("📢 Опубликовано в канале (кнопки, без фото)!");
        return res;
    } catch (e) {
        console.log("⚠️  С кнопками не вышло: " + (e?.message ?? e));
    }

    try {
        const res = await bot.api.sendMessageToChat(CHANNEL_ID, text);
        console.log("📢 Опубликовано в канале (текст)!");
        return res;
    } catch (e) {
        console.log("⚠️  Текст не вышло: " + (e?.message ?? e));
    }

    return null;
}

// ── ПРИВЕТСТВИЕ ────────────────────────────────────────────
async function sendWelcome(ctx, name) {
    const welcomeText = `Привет, ${name}! 👋\n\nЯ бот барахолки «У соседа» — Бояркино и окрестности.\nЗдесь соседи продают, покупают и меняются вещами.\n\n📢 Чтобы разместить объявление, нажми «Подать объявление»: я задам 8 простых вопросов, можно прикрепить до 10 фото.\n\n🗑 После публикации в этом чате будет личная кнопка удаления, если вещь продана или объявление уже не нужно.`;
    await ctx.reply(welcomeText, { format: "markdown", attachments: [mainMenuKeyboard()] });
}

async function beginListing(ctx, uid) {
    if (!uid || isFromChannel(ctx)) return;
    store.knownUsers[uid] = true;
    store.activeForms[uid] = { step: "title", userId: uid, photos: [], createdAt: Date.now() };
    saveStore();
    await replyPrivate(ctx, uid,
        `Привет, ${userNameOf(ctx)}! 👋\n\nДобро пожаловать в барахолку «У соседа»!\n\n📝 Я помогу опубликовать объявление. Ответь на 8 простых вопросов: название, описание, цена, место, фото, телефон, имя и подтверждение. После публикации пришлю кнопку для удаления.\n\n**Шаг 1 из 8:** Что будем выкладывать?\n\n_Напиши название товара, например «Велосипед»._`,
        { format: "markdown" });
}

// Открытие ссылки из канала вызывает событие bot_started с payload=sell.
bot.on("bot_started", async (ctx) => {
    if (isFromChannel(ctx)) return;
    const uid = userIdOf(ctx);
    if (ctx.update?.payload === "sell" || ctx.payload === "sell") {
        await beginListing(ctx, uid);
    } else {
        store.knownUsers[uid] = true;
        saveStore();
        await replyPrivate(ctx, uid,
            `Привет, ${userNameOf(ctx)}! Выбери, что хочешь сделать:\n\n📢 Подать объявление — 8 простых шагов.\n🗑 После публикации получишь кнопку для удаления объявления.`,
            { attachments: [mainMenuKeyboard()] });
    }
});
bot.command("start", async (ctx) => {
    if (isFromChannel(ctx)) return;
    await beginListing(ctx, userIdOf(ctx));
});

// ── КНОПКА: ОТДАМ ДАРОМ ────────────────────────────────────
bot.action(/^price:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    
    if (action === "free" && store.activeForms[uid]) {
        const form = store.activeForms[uid];
        form.price = 0;
        form.step = "location";
        saveStore();
        await replyPrivate(ctx, uid,
            "✅ Цена: **🎁 Бесплатно / отдам даром**\n\n**Шаг 4 из 8:** Где ты находишься?\n\n_Напиши деревню или СНТ (например: д. Бояркино или СНТ \"Берёзка\")_",
            { format: "markdown" });
    }
});

// ── МЕНЮ ───────────────────────────────────────────────────
bot.action(/^menu:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    console.log("🔘 Нажата кнопка: " + action + " от юзера " + uid);
    
    if (action === "sell") {
        await beginListing(ctx, uid);
        return;
    }
    
    if (action === "help") {
        const backMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("🔙 Назад в меню", "menu:back")]]);
        await replyPrivate(ctx, uid,
            "❓ **Как пользоваться:**\n\n1️⃣ Нажми «Подать объявление» под постом — бот откроется в личном чате.\n2️⃣ Ответь на 8 вопросов. При желании добавь до 10 фотографий.\n3️⃣ Подтверди публикацию — объявление появится в канале.\n4️⃣ В этом чате придёт кнопка «Снять моё объявление». Используй её, когда объявление перестанет быть актуальным.\n\nЕсли бот уже был открыт раньше, нажми в личном чате «Подать объявление» или отправь /start.\n\nВещь можно отдать даром. Для отмены введи «отмена».",
            { format: "markdown", attachments: [backMenu] });
        return;
    }
    
    if (action === "back") {
        if (store.activeForms[uid]) { delete store.activeForms[uid]; }
        saveStore();
        await replyPrivate(ctx, uid, "Главное меню:\n\nЧто хочешь сделать?", { format: "markdown", attachments: [mainMenuKeyboard()] });
        return;
    }
});

// ── ОБРАБОТКА ВСЕХ СООБЩЕНИЙ ───────────────────────────────

bot.hears(/.*/, async (ctx) => {
    if (isFromChannel(ctx)) return; // 🛡️ ГЛАВНАЯ ЗАЩИТА: свои посты в канале бот не читает
    
    const uid = userIdOf(ctx);
    const text = getText(ctx);
    
    if (!store.activeForms[uid]) {
        if (!store.knownUsers[uid]) {
            store.knownUsers[uid] = true;
            saveStore();
            await sendWelcome(ctx, userNameOf(ctx));
            return;
        }
        
        await ctx.reply("Используй кнопки ниже 👇", { format: "markdown", attachments: [mainMenuKeyboard()] });
        return;
    }
    
    const form = store.activeForms[uid];
    
    // Шаг 5: ФОТО
    if (form.step === "photo") {
        const photos = getPhotos(ctx);
        if (photos.length > 0) {
            form.photos = form.photos || [];
            form.photos.push(...photos);
            if (form.photos.length > 10) form.photos = form.photos.slice(0, 10);
            saveStore();
            const doneMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("✅ Готово", "photo:done")]]);
            await ctx.reply(`✅ Добавлено! Всего фото: **${form.photos.length}**\n\n_Пришли ещё или нажми кнопку:_`, { format: "markdown", attachments: [doneMenu] });
            return;
        }
        if (text && typeof text === "string" && !text.startsWith("/")) {
            await ctx.reply("⚠️ Я не вижу фото. Пришли фотографию или нажми кнопку «Готово»", { format: "markdown" });
        }
        return;
    }
    
    if (typeof text === "string" && text.startsWith("/")) return;
    if (!text || typeof text !== "string") return;
    
    if (text.toLowerCase() === "отмена") {
        delete store.activeForms[uid];
        saveStore();
        await ctx.reply("❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenuKeyboard()] });
        return;
    }
    
    // Шаг 1: Название
    if (form.step === "title") {
        form.title = text.trim();
        form.step = "description";
        saveStore();
        await ctx.reply(`✅ Название: **${form.title}**\n\n**Шаг 2 из 8:** Описание товара\n\n_Напиши состояние, комплектацию и другие детали_`, { format: "markdown" });
        return;
    }
    
    // Шаг 2: Описание
    if (form.step === "description") {
        form.description = text.trim();
        form.step = "price";
        saveStore();
        const priceMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("🎁 Отдам даром", "price:free")]]);
        await ctx.reply(`✅ Описание сохранено\n\n**Шаг 3 из 8:** Какая цена?\n\n_Напиши цену в рублях или нажми кнопку:_`, { format: "markdown", attachments: [priceMenu] });
        return;
    }
    
    // Шаг 3: Цена
    if (form.step === "price") {
        const price = parseInt(text.replace(/\D/g, ""));
        if (isNaN(price) || price < 0) {
            return ctx.reply("❌ **Неверная цена!**\n\nНапиши цену числом (например: 5000) или нажми «🎁 Отдам даром»", { format: "markdown" });
        }
        form.price = price;
        form.step = "location";
        saveStore();
        await ctx.reply(`✅ Цена: **${fmtPrice(form.price)}**\n\n**Шаг 4 из 8:** Где ты находишься?\n\n_Напиши деревню или СНТ (например: д. Бояркино или СНТ \"Берёзка\")_`, { format: "markdown" });
        return;
    }
    
    // Шаг 4: Местоположение
    if (form.step === "location") {
        form.location = text.trim();
        form.step = "photo";
        form.photos = form.photos || [];
        saveStore();
        const photoMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("✅ Готово", "photo:done")]
        ]);
        await ctx.reply(`✅ Место: **${form.location}**\n\n**Шаг 5 из 8:** Прикрепи фото товара\n\n_Можно прислать несколько сразу (до 10). Когда закончишь — нажми «✅ Готово»_`, { format: "markdown", attachments: [photoMenu] });
        return;
    }
    
    // Шаг 6: Телефон (обязательный)
    if (form.step === "phone") {
        const phone = text.trim();
        const digits = phone.replace(/\D/g, "");
        if (digits.length < 10) {
            return ctx.reply("❌ **Неверный телефон!**\n\nНапиши номер с цифрами (например: 8-999-123-45-67)", { format: "markdown" });
        }
        form.phone = phone;
        form.step = "name";
        saveStore();
        await ctx.reply(`✅ Телефон: **${form.phone}**\n\n**Шаг 7 из 8:** Как к вам обращаться?\n\n_Напиши имя для объявления (например: Виктор или Анна Петровна)_`, { format: "markdown" });
        return;
    }
    
    // Шаг 7: Имя продавца
    if (form.step === "name") {
        form.sellerName = text.trim();
        form.step = "confirm";
        saveStore();
        
        const count = (form.photos || []).length;
        const confirmMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("✅ Опубликовать", "publish:yes")],
            [Keyboard.button.callback("❌ Отменить", "publish:no")]
        ]);
        await replyPrivate(ctx, uid,
            `**Предпросмотр:**\n\n🏷️ **${form.title}**\n📝 **Описание:** ${form.description}\n💰 **Цена:** ${fmtPrice(form.price)}\n📍 **Где:** ${form.location}\n📷 **Фото:** ${count > 0 ? count + " шт." : "нет"}\n📞 **Телефон:** ${form.phone}\n👤 **Продавец:** ${form.sellerName}\n\n**Шаг 8 из 8:** Подтверди публикацию:`,
            { format: "markdown", attachments: [confirmMenu] });
        return;
    }
});

// ── КНОПКИ ФОТО ────────────────────────────────────────────
bot.action(/^photo:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    if (!store.activeForms[uid]) return;
    const form = store.activeForms[uid];
    
    if (action === "done") {
        form.step = "phone";
        saveStore();
        await replyPrivate(ctx, uid,
            "✅ Фото сохранены\n\n**Шаг 6 из 8:** Твой номер телефона для связи\n\n_Напиши номер (например: 8-999-123-45-67)_",
            { format: "markdown" });
    }
});

// ── ПУБЛИКАЦИЯ / ОТМЕНА ────────────────────────────────────
bot.action(/^publish:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    
    if (action === "no") {
        if (store.activeForms[uid]) { delete store.activeForms[uid]; saveStore(); }
        return replyPrivate(ctx, uid, "❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenuKeyboard()] });
    }
    
    if (action === "yes" && store.activeForms[uid]) {
        const form = store.activeForms[uid];
        await finalizeListing(ctx, form, uid);
    }
});

// Удаление собственных объявлений доступно из личной карточки управления.
// Подписанный callback работает даже после перезапуска бесплатного Render.
bot.action(/^del:(ask|yes|no):((?:mid\\.)?[A-Za-z0-9_-]+):([a-f0-9]{24})$/, async (ctx) => {
    if (isFromChannel(ctx)) return;
    const [, action, mid, sig] = ctx.match;
    const uid = userIdOf(ctx);
    if (!validDeleteSignature(uid, mid, sig)) {
        await replyPrivate(ctx, uid, "⛔ Удалить объявление может только его автор.");
        return;
    }
    if (action === "ask") {
        await replyPrivate(ctx, uid, "🗑 **Точно удалить это объявление из канала?**\n\nОтменить удаление после подтверждения нельзя.",
            { format: "markdown", attachments: [deleteKeyboard(uid, mid, true)] });
        return;
    }
    if (action === "no") {
        await replyPrivate(ctx, uid, "✅ Объявление остаётся в канале.", { attachments: [deleteKeyboard(uid, mid)] });
        return;
    }
    try {
        const response = await fetch(MAX_API + "/messages?message_id=" + encodeURIComponent(mid), {
            method: "DELETE",
            headers: { Authorization: TOKEN },
            signal: AbortSignal.timeout(15000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success !== true) {
            throw new Error("HTTP " + response.status + ": " + (result.message || "MAX не подтвердил удаление"));
        }
        const item = store.items.find(item => String(item.channelMessageId) === String(mid));
        if (item) item.status = "deleted";
        saveStore();
        await replyPrivate(ctx, uid, "✅ Объявление удалено из канала «У соседа». Спасибо, что поддерживаешь актуальность объявлений!", { attachments: [mainMenuKeyboard()] });
        console.log("🗑 Автор удалил пост " + mid);
    } catch (error) {
        console.error("❌ Ошибка удаления " + mid + ": " + (error?.message || error));
        await replyPrivate(ctx, uid,
            "⚠️ Не удалось удалить объявление. Возможно, оно уже удалено, либо у бота нет права на удаление публикаций. Повтори попытку позже или обратись к администратору.",
            { attachments: [deleteKeyboard(uid, mid)] });
    }
});

async function finalizeListing(ctx, form, uid) {
    const newItem = {
        id: store.nextId,
        sellerId: form.userId,
        sellerName: form.sellerName,
        title: form.title,
        price: form.price,
        description: form.description,
        location: form.location || "не указано",
        phone: form.phone,
        photos: form.photos || [],
        status: "active",
        createdAt: Date.now(),
    };
    // Сначала публикуем: не объявляем успех и не удаляем форму до подтверждения от MAX.
    const res = await sendToChannel(buildChannelText(newItem), [...newItem.photos, buildChannelButtons(newItem)]);
    if (!res) {
        await replyPrivate(ctx, uid, "⚠️ Объявление пока не опубликовано. Данные сохранены — нажми «Опубликовать» ещё раз чуть позже.");
        return;
    }
    const mid = sentPostId(res);
    store.nextId++;
    newItem.channelMessageId = mid;
    store.items.push(newItem);
    delete store.activeForms[uid];
    saveStore();

    console.log(`✅ Создано объявление №${newItem.id}: ${newItem.title} (фото: ${newItem.photos.length}, post ID: ${mid || "не найден"})`);
    if (!mid) {
        await replyPrivate(ctx, uid, "✅ Объявление опубликовано!\n\n⚠️ MAX не вернул идентификатор поста, поэтому автоматическая кнопка удаления недоступна. Для удаления этого объявления обратись к администратору канала.");
        return;
    }
    await replyPrivate(ctx, uid,
        `✅ **Объявление опубликовано!**\n\n🏷️ ${newItem.title}\n\n📢 Посмотреть: ${CHANNEL_LINK}\n\nКогда товар продан или объявление перестало быть актуальным, нажми кнопку ниже. Сохрани это сообщение — оно позволяет тебе удалить свой пост даже после перезапуска бота.`,
        { format: "markdown", attachments: [deleteKeyboard(uid, mid)] });
}

// ── ВЕБ-СЕРВЕР ─────────────────────────────────────────────
const http = await import("node:http");
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Барахолка «У соседа» работает! ✅");
}).listen(port, () => {
  console.log("🌐 Веб-сервер запущен на порту " + port);
});

// ── ЗАПУСК И АВТОПЕРЕЗАПУСК ────────────────────────────────
process.on("unhandledRejection", (err) => {
    const msg = String(err?.message ?? err) + " " + String(err?.cause?.message ?? "") + " " + String(err?.cause?.code ?? "");
    console.error("⚠️ Ошибка: " + msg);
    if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|fetch failed|socket|not valid JSON|Unexpected token/i.test(msg)) {
        console.log("🔄 Сетевой или JSON сбой — перезапускаю бота (Render поднимет заново)…");
        process.exit(1);
    }
});

console.log("🚀 Барахолка «У соседа» (Бояркино) v5 запускается… Будильник: ОТКЛЮЧЁН");
bot.start();
