// ============================================================
//  🛒 БАРАХОЛКА "У СОСЕДА" — Бояркино и окрестности
//  v5: будильник (авто-пост 19:00 МСК) ПОЛНОСТЬЮ ОТКЛЮЧЁН
// ============================================================

import { Bot, Keyboard } from "@maxhub/max-bot-api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// ── НАСТРОЙКИ ──────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID ? Number(process.env.CHANNEL_ID) : -78241752722859;
const CHANNEL_LINK = process.env.CHANNEL_LINK || "https://max.ru/channel_usoseda";
const BOT_LINK = "https://max.ru/id772021011900_1_bot";
const SELL_LINK = `${BOT_LINK}?start=sell`;
const MAX_API = "https://platform-api2.max.ru";
const ADMIN_MAX_ID = String(process.env.ADMIN_MAX_ID || "").trim();
const ALERT_TELEGRAM_BOT_TOKEN = String(process.env.ALERT_TELEGRAM_BOT_TOKEN || "").trim();
const ALERT_TELEGRAM_CHAT_ID = String(process.env.ALERT_TELEGRAM_CHAT_ID || "").trim();
const BOOT_AT = Date.now();
let lastMaxProbeAt = 0;
let lastMaxOkAt = 0;
let lastMaxError = "";
let maxProbePromise = null;
let lastAdminErrorAt = 0;
let lastAdminErrorText = "";


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

// ── ТЕХНИЧЕСКИЙ МОНИТОРИНГ ──────────────────────────────────
// /health работает независимо от корневого /, чтобы UptimeRobot видел
// остановку Long Polling даже тогда, когда HTTP-сервер продолжает отвечать.
function pollingActive() {
    return bot.pollingIsStarted === true;
}
async function checkMaxApi() {
    const now = Date.now();
    if (maxProbePromise) return maxProbePromise;
    if (now - lastMaxProbeAt < 30_000) return lastMaxOkAt > 0 && now - lastMaxOkAt < 7 * 60_000;
    lastMaxProbeAt = now;
    maxProbePromise = (async () => {
        try {
            const response = await fetch(MAX_API + "/me", {
                headers: { Authorization: TOKEN },
                signal: AbortSignal.timeout(8_000)
            });
            if (!response.ok) throw new Error("MAX API HTTP " + response.status);
            const info = await response.json();
            if (info?.is_bot !== true) throw new Error("MAX API ответил без is_bot=true");
            lastMaxOkAt = Date.now();
            lastMaxError = "";
            return true;
        } catch (error) {
            lastMaxError = String(error?.message || error).slice(0, 180);
            console.warn("⚠️ Проверка MAX API: " + lastMaxError);
            return false;
        } finally {
            maxProbePromise = null;
        }
    })();
    return maxProbePromise;
}
async function notifyAdmin(text) {
    const jobs = [];
    if (ADMIN_MAX_ID && /^\d+$/.test(ADMIN_MAX_ID)) {
        jobs.push(bot.api.sendMessageToUser(Number(ADMIN_MAX_ID), text)
            .catch(e => console.warn("⚠️ Не отправилось уведомление в MAX: " + (e?.message || e))));
    }
    if (ALERT_TELEGRAM_BOT_TOKEN && ALERT_TELEGRAM_CHAT_ID) {
        jobs.push(fetch("https://api.telegram.org/bot" + ALERT_TELEGRAM_BOT_TOKEN + "/sendMessage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: ALERT_TELEGRAM_CHAT_ID, text }),
            signal: AbortSignal.timeout(8_000)
        }).then(async (r) => {
            if (!r.ok) throw new Error("Telegram HTTP " + r.status);
        }).catch(e => console.warn("⚠️ Не отправилось уведомление в Telegram: " + (e?.message || e))));
    }
    if (jobs.length) await Promise.allSettled(jobs);
}
function alertAdminOnError(message) {
    const summary = String(message).slice(0, 350);
    const now = Date.now();
    if (now - lastAdminErrorAt < 30 * 60_000) return;
    lastAdminErrorAt = now;
    lastAdminErrorText = summary;
    void notifyAdmin("⚠️ BaraholkaBot: ошибка при работе.\n" + summary +
        "\n\nЕсли бот не отвечает, проверь монитор UptimeRobot.");
}

// Команда нужна только для безопасной привязки владельца к приватным алертам.
bot.command("myid", async (ctx) => {
    if (isFromChannel(ctx)) return;
    const uid = userIdOf(ctx);
    if (uid) await replyPrivate(ctx, uid,
        "🆔 Твой ID в MAX: " + uid +
        "\n\nДля личных уведомлений о работе барахолки нужно добавить этот ID в настройки сервера. Токены бота сообщать не нужно.");
});
bot.command("status", async (ctx) => {
    if (isFromChannel(ctx)) return;
    const uid = userIdOf(ctx);
    if (!uid) return;
    if (!ADMIN_MAX_ID || String(uid) !== ADMIN_MAX_ID) {
        return replyPrivate(ctx, uid, "🔒 Технический статус доступен только администратору. Чтобы подключить его, используй /myid.");
    }
    await checkMaxApi();
    await replyPrivate(ctx, uid,
        "🩺 BaraholkaBot\n" +
        "Приём событий MAX: " + (pollingActive() ? "✅ работает" : "❌ остановлен") + "\n" +
        "MAX API: " + (Date.now() - lastMaxOkAt < 7 * 60_000 ? "✅ доступен" : "❌ нет подтверждения") + "\n" +
        "Время работы процесса: " + Math.floor((Date.now() - BOOT_AT) / 60_000) + " мин.");
});

// Обработка ошибок в пользовательских действиях отдельно от транспортного
// polling: единичная ошибка заявки не должна обрывать получение новых сообщений.
bot.catch(async (err) => {
    const message = String(err?.message || err);
    console.error("❌ Ошибка обработчика MAX: " + message);
    alertAdminOnError(message);
});

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
    // На разных сборках SDK link может отсутствовать; используем формат MAX API напрямую.
    const button = typeof Keyboard.button.link === "function"
        ? Keyboard.button.link("📢 Подать объявление", SELL_LINK)
        : { type: "link", text: "📢 Подать объявление", url: SELL_LINK };
    return Keyboard.inlineKeyboard([[button]]);
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

// ── НАВИГАЦИЯ ПО ОБЪЯВЛЕНИЮ ────────────────────────────────
const FORM_STEPS = ["title", "description", "price", "location", "photo", "phone", "name", "confirm"];
function draftId(form) {
    if (!form.draftId) {
        form.draftId = randomBytes(6).toString("hex");
        saveStore();
    }
    return form.draftId;
}
function stepKeyboard(form) {
    const id = draftId(form);
    const s = form.step;
    const cb = (label, action) => Keyboard.button.callback(label, action);
    const rows = [];
    if (s === "confirm") {
        rows.push([cb("✅ Опубликовать", "publish:yes:" + id)]);
        rows.push([cb("✏️ Изменить данные", "nav:edit:" + id)]);
    } else if (s === "price") {
        rows.push([cb("🎁 Отдам даром", "price:free:" + id)]);
    } else if (s === "photo") {
        rows.push([cb("✅ Готово, далее", "photo:done:" + id)]);
        if ((form.photos || []).length) rows.push([cb("🗑 Удалить все фото", "photo:clear:" + id)]);
    }
    if (s !== "title") rows.push([cb("⬅️ К предыдущему шагу", "nav:back:" + id + ":" + s)]);
    if (form.editing && s !== "confirm") rows.push([cb("↩️ К предпросмотру", "nav:review:" + id + ":" + s)]);
    rows.push([cb("❌ Отменить оформление", "nav:cancel:" + id)]);
    return Keyboard.inlineKeyboard(rows);
}
async function askStep(ctx, uid, form, note = "") {
    const s = form.step;
    const n = FORM_STEPS.indexOf(s);
    if (n === -1) return;
    let t = note ? note + "\n\n" : "";
    if (s === "confirm") {
        t += "**Предпросмотр объявления:**\n\n" +
            "🏷 **" + (form.title || "—") + "**\n" +
            "📝 **Описание:** " + (form.description || "—") + "\n" +
            "💰 **Цена:** " + (form.price == null ? "—" : fmtPrice(form.price)) + "\n" +
            "📍 **Где:** " + (form.location || "—") + "\n" +
            "📷 **Фото:** " + (form.photos || []).length + " шт.\n" +
            "📞 **Телефон:** " + (form.phone || "—") + "\n" +
            "👤 **Продавец:** " + (form.sellerName || "—") + "\n\n" +
            "**Шаг 8 из 8:** Проверь данные. Можно исправить любое поле или вернуться на шаг 7.";
    } else {
        const prompts = {
            title: ["Что будем выкладывать?", "Напиши название товара, например «Велосипед»."],
            description: ["Описание товара", "Напиши состояние, комплектацию и другие детали."],
            price: ["Какая цена?", "Напиши цену в рублях или нажми «🎁 Отдам даром»."],
            location: ["Где ты находишься?", "Напиши деревню или СНТ, например Бояркино."],
            photo: ["Прикрепи фотографии", "До 10 фото. Когда закончишь — нажми «✅ Готово, далее». Можно и без фото."],
            phone: ["Твой телефон для связи", "Напиши номер, например 8-999-123-45-67."],
            name: ["Как к тебе обращаться?", "Напиши имя для объявления."]
        };
        const current = {
            title: form.title, description: form.description,
            price: form.price == null ? null : fmtPrice(form.price),
            location: form.location, photo: (form.photos || []).length + " шт.",
            phone: form.phone, name: form.sellerName
        };
        t += "**Шаг " + (n + 1) + " из 8:** " + prompts[s][0] + "\n\n_" + prompts[s][1] + "_";
        if (current[s] != null && current[s] !== "") t += "\n\nТекущее значение: " + current[s];
        if (form.editing) t += "\n\n✏️ После исправления сразу вернёмся к предпросмотру.";
    }
    return replyPrivate(ctx, uid, t, { format: "markdown", attachments: [stepKeyboard(form)] });
}
async function nextStep(ctx, uid, form, next, note) {
    if (form.editing) {
        form.editing = false;
        form.step = "confirm";
    } else {
        form.step = next;
    }
    form.cancelPending = false;
    form.clearPending = false;
    saveStore();
    return askStep(ctx, uid, form, note);
}
async function outdatedButton(ctx, uid) {
    return replyPrivate(ctx, uid, "⚠️ Эта кнопка от другого шага или старого объявления. Используй кнопки в последнем сообщении бота.");
}
function editMenu(form) {
    const id = draftId(form);
    const cb = (label, step) => Keyboard.button.callback(label, "nav:field:" + id + ":" + step);
    return Keyboard.inlineKeyboard([
        [cb("🏷 Название", "title"), cb("📝 Описание", "description")],
        [cb("💰 Цена", "price"), cb("📍 Место", "location")],
        [cb("📷 Фотографии", "photo"), cb("📞 Телефон", "phone")],
        [cb("👤 Имя", "name")],
        [Keyboard.button.callback("↩️ К предпросмотру", "nav:show:" + id)]
    ]);
}
async function confirmCancel(ctx, uid, form) {
    const id = draftId(form);
    form.cancelPending = true;
    saveStore();
    return replyPrivate(ctx, uid, "⚠️ Точно отменить объявление? Только после подтверждения заполненные ответы будут удалены.", {
        attachments: [Keyboard.inlineKeyboard([
            [Keyboard.button.callback("🗑 Да, отменить", "nav:cancel_yes:" + id)],
            [Keyboard.button.callback("↩️ Нет, продолжить", "nav:cancel_no:" + id)]
        ])]
    });
}
bot.action(/^nav:(back|edit|field|review|show|cancel|cancel_yes|cancel_no):([a-f0-9]{12})(?::([a-z]+))?$/, async (ctx) => {
    if (isFromChannel(ctx)) return;
    const [, action, id, field] = ctx.match;
    const uid = userIdOf(ctx);
    const form = store.activeForms[uid];
    if (!form || draftId(form) !== id) return outdatedButton(ctx, uid);
    if (action === "cancel") return confirmCancel(ctx, uid, form);
    if (action === "cancel_yes") {
        if (!form.cancelPending) return outdatedButton(ctx, uid);
        delete store.activeForms[uid];
        saveStore();
        return replyPrivate(ctx, uid, "❌ Объявление отменено.", { attachments: [mainMenuKeyboard()] });
    }
    if (action === "cancel_no") {
        form.cancelPending = false;
        saveStore();
        return askStep(ctx, uid, form, "✅ Продолжаем. Все ответы сохранены.");
    }
    form.cancelPending = false;
    if (action === "back") {
        if (form.step !== field) return outdatedButton(ctx, uid);
        const i = FORM_STEPS.indexOf(field);
        if (i < 1) return askStep(ctx, uid, form);
        form.step = FORM_STEPS[i - 1];
        form.editing = false;
        form.clearPending = false;
        saveStore();
        return askStep(ctx, uid, form, "↩️ Вернулись назад. Предыдущие ответы сохранены, можешь их заменить.");
    }
    if (action === "edit") {
        if (form.step !== "confirm") return outdatedButton(ctx, uid);
        return replyPrivate(ctx, uid, "✏️ **Что исправить?** Выбери поле — остальные ответы сохранятся.",
            { format: "markdown", attachments: [editMenu(form)] });
    }
    if (action === "show") {
        if (form.step !== "confirm") return outdatedButton(ctx, uid);
        return askStep(ctx, uid, form);
    }
    if (action === "field") {
        if (form.step !== "confirm" || !FORM_STEPS.slice(0, 7).includes(field)) return outdatedButton(ctx, uid);
        form.editing = true;
        form.step = field;
        saveStore();
        return askStep(ctx, uid, form, "✏️ Изменение выбранного поля");
    }
    if (action === "review") {
        if (form.step !== field || !form.editing) return outdatedButton(ctx, uid);
        form.step = "confirm";
        form.editing = false;
        saveStore();
        return askStep(ctx, uid, form, "↩️ Вернулись к предпросмотру без изменений.");
    }
});

// ── ПРИВЕТСТВИЕ ────────────────────────────────────────────
async function sendWelcome(ctx, name) {
    const welcomeText = `Привет, ${name}! 👋\n\nЯ бот барахолки «У соседа» — Бояркино и окрестности.\nЗдесь соседи продают, покупают и меняются вещами.\n\n📢 Чтобы разместить объявление, нажми «Подать объявление»: я задам 8 простых вопросов, можно прикрепить до 10 фото.\n\n🗑 После публикации в этом чате будет личная кнопка удаления, если вещь продана или объявление уже не нужно.`;
    await ctx.reply(welcomeText, { format: "markdown", attachments: [mainMenuKeyboard()] });
}

async function beginListing(ctx, uid) {
    if (!uid) return;
    store.knownUsers[uid] = true;
    if (store.activeForms[uid]) {
        return askStep(ctx, uid, store.activeForms[uid],
            "📝 У тебя уже есть начатое объявление. Продолжим с того же места.");
    }
    const form = {
        step: "title", userId: uid, photos: [], createdAt: Date.now(),
        draftId: randomBytes(6).toString("hex")
    };
    store.activeForms[uid] = form;
    saveStore();
    return askStep(ctx, uid, form,
        "Привет, " + userNameOf(ctx) + "! 👋\n\n" +
        "Я помогу подать объявление за 8 шагов. Всегда можно вернуться назад, а перед публикацией исправить любой ответ.");
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
bot.action(/^price:free(?::([a-f0-9]{12}))?$/, async (ctx) => {
    if (isFromChannel(ctx)) return;
    const uid = userIdOf(ctx), form = store.activeForms[uid], id = ctx.match[1];
    if (!form || form.step !== "price" || (id && draftId(form) !== id)) return outdatedButton(ctx, uid);
    form.price = 0;
    return nextStep(ctx, uid, form, "location", "✅ Цена: 🎁 Бесплатно");
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

// ── ОБРАБОТКА СООБЩЕНИЙ ────────────────────────────────────
bot.hears(/.*/, async (ctx) => {
    if (isFromChannel(ctx)) return;
    const uid = userIdOf(ctx);
    const text = getText(ctx);
    const form = store.activeForms[uid];
    if (!form) {
        if (!store.knownUsers[uid]) {
            store.knownUsers[uid] = true;
            saveStore();
            return sendWelcome(ctx, userNameOf(ctx));
        }
        return replyPrivate(ctx, uid, "Используй кнопки ниже 👇", { attachments: [mainMenuKeyboard()] });
    }
    const value = typeof text === "string" ? text.trim() : "";
    if (value.toLowerCase() === "отмена") return confirmCancel(ctx, uid, form);
    if (form.step === "photo") {
        const photos = getPhotos(ctx);
        if (photos.length) {
            form.photos = (form.photos || []).concat(photos).slice(0, 10);
            form.clearPending = false;
            saveStore();
            return askStep(ctx, uid, form, "✅ Добавлено фотографий: " + form.photos.length + " из 10.");
        }
        if (value && !value.startsWith("/")) return askStep(ctx, uid, form,
            "⚠️ Не вижу фото. Пришли изображение или нажми «Готово, далее».");
        return;
    }
    if (value.startsWith("/")) return;
    if (form.step === "confirm") return askStep(ctx, uid, form,
        "ℹ️ Для исправления используй кнопку «Изменить данные».");
    if (!value) return;
    if (form.step === "title") {
        form.title = value;
        return nextStep(ctx, uid, form, "description", "✅ Название сохранено.");
    }
    if (form.step === "description") {
        form.description = value;
        return nextStep(ctx, uid, form, "price", "✅ Описание сохранено.");
    }
    if (form.step === "price") {
        const price = parseInt(value.replace(/\D/g, ""), 10);
        if (!Number.isFinite(price) || price < 0) return askStep(ctx, uid, form, "❌ Укажи цену числом, например 5000.");
        form.price = price;
        return nextStep(ctx, uid, form, "location", "✅ Цена сохранена.");
    }
    if (form.step === "location") {
        form.location = value;
        return nextStep(ctx, uid, form, "photo", "✅ Место сохранено.");
    }
    if (form.step === "phone") {
        if (value.replace(/\D/g, "").length < 10) return askStep(ctx, uid, form,
            "❌ Укажи телефон не менее чем из 10 цифр.");
        form.phone = value;
        return nextStep(ctx, uid, form, "name", "✅ Телефон сохранён.");
    }
    if (form.step === "name") {
        form.sellerName = value;
        return nextStep(ctx, uid, form, "confirm", "✅ Имя сохранено. Проверь объявление перед публикацией.");
    }
});

// ── КНОПКИ ФОТО ────────────────────────────────────────────
bot.action(/^photo:(done|clear|clear_yes|clear_no)(?::([a-f0-9]{12}))?$/, async (ctx) => {
    if (isFromChannel(ctx)) return;
    const [, action, id] = ctx.match;
    const uid = userIdOf(ctx), form = store.activeForms[uid];
    if (!form || form.step !== "photo" || (id && draftId(form) !== id)) return outdatedButton(ctx, uid);
    if (action === "done") return nextStep(ctx, uid, form, "phone",
        "✅ Фотографии сохранены: " + (form.photos || []).length + " шт.");
    if (action === "clear") {
        form.clearPending = true;
        saveStore();
        return replyPrivate(ctx, uid, "⚠️ Удалить все фотографии из черновика?", {
            attachments: [Keyboard.inlineKeyboard([
                [Keyboard.button.callback("🗑 Да, убрать фото", "photo:clear_yes:" + draftId(form))],
                [Keyboard.button.callback("↩️ Оставить фото", "photo:clear_no:" + draftId(form))]
            ])]
        });
    }
    if (action === "clear_yes") {
        if (!form.clearPending) return outdatedButton(ctx, uid);
        form.photos = [];
        form.clearPending = false;
        saveStore();
        return askStep(ctx, uid, form, "✅ Фотографии убраны. Можно прикрепить новые.");
    }
    if (action === "clear_no") {
        form.clearPending = false;
        saveStore();
        return askStep(ctx, uid, form, "✅ Фотографии остались.");
    }
});

// ── ПУБЛИКАЦИЯ / ОТМЕНА ────────────────────────────────────
bot.action(/^publish:(yes|no)(?::([a-f0-9]{12}))?$/, async (ctx) => {
    if (isFromChannel(ctx)) return;
    const [, action, id] = ctx.match;
    const uid = userIdOf(ctx), form = store.activeForms[uid];
    if (!form || form.step !== "confirm" || (id && draftId(form) !== id)) return outdatedButton(ctx, uid);
    if (action === "no") return confirmCancel(ctx, uid, form);
    if (form.publishing) return replyPrivate(ctx, uid, "⏳ Публикация уже выполняется, не нажимай повторно.");
    form.publishing = true;
    saveStore();
    try {
        await finalizeListing(ctx, form, uid);
    } finally {
        if (store.activeForms[uid] === form) {
            form.publishing = false;
            saveStore();
        }
    }
});

// Удаление собственных объявлений доступно из личной карточки управления.
// Подписанный callback работает даже после перезапуска бесплатного Render.
bot.action(/^del:(ask|yes|no):((?:mid\.)?[A-Za-z0-9_-]+):([a-f0-9]{24})$/, async (ctx) => {
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

// ── ВЕБ-СЕРВЕР И ПРОВЕРКА РАБОТОСПОСОБНОСТИ ───────────────
const http = await import("node:http");
const port = process.env.PORT || 3000;
http.createServer(async (req, res) => {
    const path = new URL(req.url || "/", "http://localhost").pathname;
    if (path === "/health") {
        await checkMaxApi();
        const maxAvailable = lastMaxOkAt > 0 && Date.now() - lastMaxOkAt < 7 * 60_000;
        const ready = pollingActive() && maxAvailable;
        res.writeHead(ready ? 200 : 503, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        });
        res.end(JSON.stringify({
            status: ready ? "ok" : "unhealthy",
            polling: pollingActive(),
            max_api: maxAvailable,
            uptime_seconds: Math.floor((Date.now() - BOOT_AT) / 1000)
        }));
        return;
    }
    if (path !== "/") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Не найдено");
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Барахолка «У соседа» работает! ✅");
}).listen(port, () => console.log("🌐 Веб-сервер запущен на порту " + port));

// ── ЗАЩИТА ОТ ОСТАНОВКИ MAX LONG POLLING ───────────────────
// Библиотека 0.3.1 умеет повторять сетевые запросы. Если её polling
// остановился целиком, Node остаётся живым: watchdog перезапускает процесс,
// который Render затем поднимает автоматически.
let pollingStoppedTicks = 0;
let restarting = false;
function restartProcess(reason) {
    if (restarting) return;
    restarting = true;
    console.error("🔄 Контролируемый перезапуск: " + reason);
    void notifyAdmin("⚠️ BaraholkaBot перезапускается: " + reason)
        .finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 10_000).unref();
}
setInterval(() => {
    if (Date.now() - BOOT_AT < 120_000) return;
    if (pollingActive()) {
        pollingStoppedTicks = 0;
        return;
    }
    pollingStoppedTicks += 1;
    console.warn("⚠️ Polling MAX остановлен: контроль " + pollingStoppedTicks + "/2");
    if (pollingStoppedTicks >= 2) restartProcess("неактивный приём событий MAX");
}, 60_000).unref();

process.on("unhandledRejection", (err) => {
    const msg = String(err?.message || err);
    console.error("⚠️ Необработанная ошибка: " + msg);
    alertAdminOnError(msg);
    // Единичные сетевые ошибки теперь обрабатывает SDK (retry/backoff).
    // Watchdog перезапускает процесс, только если приём событий остановился.
});

console.log("🚀 BaraholkaBot запускается: MAX SDK polling + контроль здоровья + оповещения.");
void bot.start({ mode: "polling", options: { retry: true } }).then(() => {
    console.warn("⚠️ MAX polling неожиданно завершился.");
}).catch(error => {
    console.error("❌ Не удалось запустить MAX polling:", error?.message || error);
    restartProcess("ошибка запуска MAX polling");
});
// Уведомление отправляется только после подтверждения работоспособности API.
setTimeout(async () => {
    const ok = await checkMaxApi();
    if (ok && pollingActive()) {
        console.log("✅ Проверка MAX API и polling пройдена.");
        await notifyAdmin("✅ BaraholkaBot запущен и подключён к MAX. Контроль здоровья работает.");
    }
}, 20_000).unref();
