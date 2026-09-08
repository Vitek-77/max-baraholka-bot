// ============================================================
// 🛒 БАРАХОЛКА "У СОСЕДА" — Бояркино и окрестности
// v4: ВНУТРЕННИЙ БУДИЛЬНИК — вечерняя витрина + уборка старых
// ============================================================
import { Bot, Keyboard } from "@maxhub/max-bot-api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import http from "node:http";

const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID ? Number(process.env.CHANNEL_ID) : -78241752722859;
const CHANNEL_LINK = process.env.CHANNEL_LINK || "https://max.ru/channel_usoseda";
const BOT_LINK = process.env.BOT_LINK || "https://max.ru/BaraholkaBot";
const DIGEST_TIMES = (process.env.DIGEST_TIMES || "19:00").split(",").map(s => s.trim());
const CLEAN_TIME = process.env.CLEAN_TIME || "03:00";
const TTL_DAYS = Number(process.env.ITEM_TTL_DAYS || 30);

// ── ХРАНИЛИЩЕ ────────────────────────────────────────────
const STORE_FILE = new URL("./store.json", import.meta.url);
let store = { nextId: 1, items: [], activeForms: {}, knownUsers: {} };
if (existsSync(STORE_FILE)) {
    try { store = { ...store, ...JSON.parse(readFileSync(STORE_FILE, "utf8")) }; console.log("📁 Загружено сохранение барахолки"); }
    catch { console.warn("️ store.json повреждён"); }
}
const saveStore = () => writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");

const bot = new Bot(TOKEN);

// ── СЛУЖЕБНЫЕ ────────────────────────────────────────────
function userIdOf(ctx) {
    return ctx.user?.user_id ?? ctx.callback?.user?.user_id ?? ctx.message?.sender?.user_id ?? ctx.from?.user_id ?? null;
}
function userNameOf(ctx) {
    return ctx.user?.name ?? ctx.callback?.user?.name ?? ctx.message?.sender?.name ?? "друг";
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
    for (const src of [ctx.message?.attachments, ctx.message?.body?.attachments, ctx.attachments]) {
        if (Array.isArray(src)) for (const a of src) if (a && (a.type === "photo" || a.type === "image")) photos.push(a);
    }
    return photos;
}
function fmtPrice(p) { return p === 0 ? "🎁 Бесплатно / отдам даром" : p + " ₽"; }
function mainMenuKeyboard() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback("📢 Подать объявление", "menu:sell")],
        [Keyboard.button.callback("❓ Помощь", "menu:help")]
    ]);
}
function botLinkButton() {
    try { if (typeof Keyboard.button.link === "function") return Keyboard.button.link("🤖 Перейти в бота", BOT_LINK); } catch (e) {}
    return { type: "link", text: "🤖 Перейти в бота", url: BOT_LINK };
}
function isFromChannel(ctx) {
    const chatType = ctx.chat?.type || ctx.message?.chat?.type || ctx.message?.recipient?.chat_type || ctx.callback?.message?.chat?.type;
    const chatId = ctx.chat?.chat_id || ctx.message?.chat?.chat_id || ctx.message?.recipient?.chat_id || ctx.callback?.message?.chat?.chat_id || ctx.chat?.id || ctx.message?.chat?.id;
    if (chatType === "channel") return true;
    if (chatId && String(chatId) === String(CHANNEL_ID)) return true;
    return false;
}
async function replyPrivate(ctx, uid, text, opts = {}) {
    try { await bot.api.sendMessageToUser(uid, text, opts); }
    catch (e) {
        if (isFromChannel(ctx)) return;
        try { await ctx.reply(text, opts); } catch (e2) { console.log("⚠️ Не удалось ответить в личку: " + (e2?.message ?? e2)); }
    }
}

// ── ПОСТ В КАНАЛ ─────────────────────────────────────────
function buildChannelText(item) {
    return [
        "📤 Поделись объявлением с соседями!", "",
        `🏷️ ${item.title}`,
        `💰 Цена: ${fmtPrice(item.price)}`,
        `📝 Описание: ${item.description}`,
        `📍 Где: ${item.location}`,
        `📞 Звонить: ${item.phone}`,
        `👤 Продавец: ${item.sellerName}`, "",
        CHANNEL_LINK
    ].join("\n");
}
async function sendToChannel(text, libAttachments) {
    try { await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: libAttachments }); console.log("📢 Опубликовано в канале (фото + кнопки)!"); return; }
    catch (e) { console.log("⚠️ С фото не вышло: " + (e?.message ?? e)); }
    try {
        const buttonsOnly = (libAttachments || []).filter(a => a?.type !== "photo" && a?.type !== "image");
        await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: buttonsOnly });
        console.log("📢 Опубликовано в канале (кнопки, без фото)!"); return;
    } catch (e) { console.log("⚠️ С кнопками не вышло: " + (e?.message ?? e)); }
    try { await bot.api.sendMessageToChat(CHANNEL_ID, text); console.log("📢 Опубликовано в канале (текст)!"); }
    catch (e) { console.log("⚠️ Текст не вышло: " + (e?.message ?? e)); }
}

// ── ПРИВЕТСТВИЕ ──────────────────────────────────────────
async function sendWelcome(ctx, name) {
    await ctx.reply(`Привет, ${name}! 👋\n\nЯ бот барахолки «У соседа» — Бояркино и окрестности.\nЗдесь соседи продают, покупают и меняются вещами.\n\nЧто хочешь сделать?`, { format: "markdown", attachments: [mainMenuKeyboard()] });
}

bot.command("start", async (ctx) => {
    if (isFromChannel(ctx)) return;
    const uid = userIdOf(ctx);
    if (store.activeForms[uid]) { delete store.activeForms[uid]; saveStore(); }
    store.knownUsers[uid] = true; saveStore();
    await sendWelcome(ctx, userNameOf(ctx));
});

// ── КНОПКИ ───────────────────────────────────────────────
bot.action(/^price:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    if (action === "free" && store.activeForms[uid]) {
        const form = store.activeForms[uid];
        form.price = 0; form.step = "location"; saveStore();
        await replyPrivate(ctx, uid, "✅ Цена: **🎁 Бесплатно / отдам даром**\n\n**Шаг 4 из 8:** Где ты находишься?\n\n_Напиши деревню или СНТ (например: д. Бояркино или СНТ \"Берёзка\")_", { format: "markdown" });
    }
});
bot.action(/^menu:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    console.log("🔘 Нажата кнопка: " + action + " от юзера " + uid);
    if (action === "sell") {
        store.activeForms[uid] = { step: "title", userId: uid, photos: [], createdAt: Date.now() }; saveStore();
        await replyPrivate(ctx, uid, "📝 **Создание объявления**\n\n**Шаг 1 из 8:** Что будем выкладывать?\n\n_Напиши название (например: велосипед)_", { format: "markdown" });
        return;
    }
    if (action === "help") {
        const backMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("🔙 Назад в меню", "menu:back")]]);
        await replyPrivate(ctx, uid, "❓ **Как пользоваться:**\n\n1️⃣ Нажми «Подать объявление»\n2️⃣ Ответь на 8 вопросов бота\n3️⃣ Объявление появится в канале «У соседа»\n4️⃣ Соседи увидят его и смогут позвонить\n\n📤 Поделиться — стрелочка пересылки у поста!\n\n🤖 **Если кнопки не нажимаются:** нажми под постом «Перейти в бота» и отправь любой символ.\n\nМожно до 10 фото. Вещь можно отдать **даром** 🎁\nОтмена: напиши `/отмена`", { format: "markdown", attachments: [backMenu] });
        return;
    }
    if (action === "back") {
        if (store.activeForms[uid]) delete store.activeForms[uid];
        saveStore();
        await replyPrivate(ctx, uid, "Главное меню:\n\nЧто хочешь сделать?", { format: "markdown", attachments: [mainMenuKeyboard()] });
    }
});
bot.action(/^photo:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    if (!store.activeForms[uid]) return;
    const form = store.activeForms[uid];
    if (action === "done") {
        form.step = "phone"; saveStore();
        await replyPrivate(ctx, uid, "✅ Фото сохранены\n\n**Шаг 6 из 8:** Твой номер телефона для связи\n\n_Напиши номер (например: 8-999-123-45-67)_", { format: "markdown" });
    }
});
bot.action(/^publish:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    if (action === "no") {
        if (store.activeForms[uid]) { delete store.activeForms[uid]; saveStore(); }
        return replyPrivate(ctx, uid, "❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenuKeyboard()] });
    }
    if (action === "yes" && store.activeForms[uid]) await finalizeListing(ctx, store.activeForms[uid], uid);
});

// ── СООБЩЕНИЯ (ФОРМА) ────────────────────────────────────
bot.hears(/.*/, async (ctx) => {
    if (isFromChannel(ctx)) return;
    const uid = userIdOf(ctx);
    const text = getText(ctx);
    if (!store.activeForms[uid]) {
        if (!store.knownUsers[uid]) { store.knownUsers[uid] = true; saveStore(); await sendWelcome(ctx, userNameOf(ctx)); return; }
        await ctx.reply("Используй кнопки ниже 👇", { format: "markdown", attachments: [mainMenuKeyboard()] });
        return;
    }
    const form = store.activeForms[uid];
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
        if (text && typeof text === "string" && !text.startsWith("/")) await ctx.reply("⚠️ Я не вижу фото. Пришли фотографию или нажми «Готово»", { format: "markdown" });
        return;
    }
    if (typeof text === "string" && text.startsWith("/")) {
        if (text.toLowerCase() === "/отмена") { delete store.activeForms[uid]; saveStore(); await ctx.reply("❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenuKeyboard()] }); }
        return;
    }
    if (!text || typeof text !== "string") return;
    if (text.toLowerCase() === "отмена") { delete store.activeForms[uid]; saveStore(); await ctx.reply("❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenuKeyboard()] }); return; }

    if (form.step === "title") {
        form.title = text.trim(); form.step = "description"; saveStore();
        await ctx.reply(`✅ Название: **${form.title}**\n\n**Шаг 2 из 8:** Описание товара\n\n_Состояние, комплектация, детали_", { format: "markdown" });
        return;
    }
    if (form.step === "description") {
        form.description = text.trim(); form.step = "price"; saveStore();
        const priceMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("🎁 Отдам даром", "price:free")]]);
        await ctx.reply("✅ Описание сохранено\n\n**Шаг 3 из 8:** Какая цена?\n\n_Напиши цену в рублях или нажми кнопку:_", { format: "markdown", attachments: [priceMenu] });
        return;
    }
    if (form.step === "price") {
        const price = parseInt(text.replace(/\D/g, ""));
        if (isNaN(price) || price < 0) return ctx.reply("❌ **Неверная цена!**\n\nНапиши цену числом (например: 5000) или нажми «🎁 Отдам даром»", { format: "markdown" });
        form.price = price; form.step = "location"; saveStore();
        await ctx.reply(`✅ Цена: **${fmtPrice(form.price)}**\n\n**Шаг 4 из 8:** Где ты находишься?\n\n_Напиши деревню или СНТ_", { format: "markdown" });
        return;
    }
    if (form.step === "location") {
        form.location = text.trim(); form.step = "photo"; form.photos = form.photos || []; saveStore();
        const photoMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("✅ Готово", "photo:done")]]);
        await ctx.reply(`✅ Место: **${form.location}**\n\n**Шаг 5 из 8:** Прикрепи фото товара\n\n_Можно несколько сразу (до 10). Когда закончишь — нажми «✅ Готово»_", { format: "markdown", attachments: [photoMenu] });
        return;
    }
    if (form.step === "phone") {
        const digits = text.replace(/\D/g, "");
        if (digits.length < 10) return ctx.reply("❌ **Неверный телефон!**\n\nНапиши номер с цифрами (например: 8-999-123-45-67)", { format: "markdown" });
        form.phone = text.trim(); form.step = "name"; saveStore();
        await ctx.reply(`✅ Телефон: **${form.phone}**\n\n**Шаг 7 из 8:** Как к вам обращаться?\n\n_Напиши имя для объявления_", { format: "markdown" });
        return;
    }
    if (form.step === "name") {
        form.sellerName = text.trim(); form.step = "confirm"; saveStore();
        const count = (form.photos || []).length;
        const confirmMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("✅ Опубликовать", "publish:yes")],
            [Keyboard.button.callback("❌ Отменить", "publish:no")]
        ]);
        await replyPrivate(ctx, uid, `**Предпросмотр:**\n\n🏷️ **${form.title}**\n📝 **Описание:** ${form.description}\n💰 **Цена:** ${fmtPrice(form.price)}\n📍 **Где:** ${form.location}\n📷 **Фото:** ${count > 0 ? count + " шт." : "нет"}\n📞 **Телефон:** ${form.phone}\n👤 **Продавец:** ${form.sellerName}\n\n**Шаг 8 из 8:** Подтверди публикацию:`, { format: "markdown", attachments: [confirmMenu] });
        return;
    }
});

async function finalizeListing(ctx, form, uid) {
    const newItem = {
        id: store.nextId++, sellerId: form.userId, sellerName: form.sellerName, title: form.title,
        price: form.price, description: form.description, location: form.location || "не указано",
        phone: form.phone, photos: form.photos || [], status: "active", createdAt: Date.now()
    };
    store.items.push(newItem);
    delete store.activeForms[uid]; saveStore();
    const privateText = [
        "📤 **Поделись объявлением с соседями!**", "",
        `🏷️ **${newItem.title}**`, `📝 **Описание:** ${newItem.description}`, `💰 **Цена:** ${fmtPrice(newItem.price)}`,
        `📍 **Где:** ${newItem.location}`, `📞 **Телефон:** ${newItem.phone}`, `👤 **Продавец:** ${newItem.sellerName}`, "", CHANNEL_LINK
    ].join("\n");
    try { await ctx.reply(privateText, { format: "markdown" }); } catch (err) { console.error("❌ Ошибка ответа продавцу:", err); }
    await sendToChannel(buildChannelText(newItem), [...newItem.photos, Keyboard.inlineKeyboard([[Keyboard.button.callback("📢 Подать объявление", "menu:sell")], [botLinkButton()]])]);
    console.log(`✅ Создано объявление №${newItem.id}: ${newItem.title} (фото: ${newItem.photos.length})`);
}

// ── ⏰ ВНУТРЕННИЙ БУДИЛЬНИК (МСК = UTC+3) ────────────────
const fired = new Set();
function cleanOld() {
    const cut = Date.now() - TTL_DAYS * 86400000;
    const before = store.items.length;
    store.items = store.items.filter(i => (i.createdAt || 0) > cut);
    if (store.items.length !== before) { saveStore(); console.log("🧹 Удалено старых объявлений: " + (before - store.items.length)); }
}
async function postDigest() {
    const items = store.items.filter(i => i.status === "active");
    if (!items.length) { console.log("📰 Дайджест: витрина пуста"); return; }
    const last = items.slice(-10).reverse();
    const lines = ["📰 Вечерняя витрина «У соседа»!", ""];
    for (const i of last) lines.push(`🏷 ${i.title} — ${fmtPrice(i.price)}\n📍 ${i.location}`);
    lines.push("", "➕ Подать своё объявление: кнопка под любым постом или " + BOT_LINK, CHANNEL_LINK);
    await bot.api.sendMessageToChat(CHANNEL_ID, lines.join("\n"));
    console.log("📰 Дайджест опубликован");
}
setInterval(() => {
    const d = new Date(Date.now() + 3 * 3600 * 1000);
    const key = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
    const day = d.toISOString().slice(0, 10);
    if (DIGEST_TIMES.includes(key) && !fired.has(day + "D" + key)) { fired.add(day + "D" + key); console.log("⏰ Будильник: витрина " + key); postDigest().catch(e => console.log("⚠️ Дайджест: " + e.message)); }
    if (key === CLEAN_TIME && !fired.has(day + "X" + key)) { fired.add(day + "X" + key); cleanOld(); }
}, 30000);

// ── ВЕБ-СЕРВЕР И АВТОПЕРЕЗАПУСК ──────────────────────────
const port = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Барахолка «У соседа» работает! ✅"); }).listen(port, () => console.log("🌐 Веб-сервер запущен на порту " + port));
process.on("unhandledRejection", (err) => {
    const msg = String(err?.message ?? err) + " " + String(err?.cause?.message ?? "");
    console.error("⚠️ Ошибка: " + msg);
    if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|fetch failed|socket|not valid JSON|Unexpected token/i.test(msg)) { console.log("🔄 Перезапускаюсь…"); process.exit(1); }
});

console.log("🚀 Барахолка «У соседа» v4 запущена. Будильник: витрина " + DIGEST_TIMES.join(", ") + ", уборка " + CLEAN_TIME + " (МСК)");
bot.start();
