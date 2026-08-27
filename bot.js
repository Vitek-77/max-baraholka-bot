// ============================================================
//  🛒 БАРАХОЛКА "У СОСЕДА" — Бояркино и окрестности
//  Полная версия: каталог, купля, рейтинг, напоминания
// ============================================================

import { Bot, Keyboard } from "@maxhub/max-bot-api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── НАСТРОЙКИ ──────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = -78241752722859;
const CHANNEL_LINK = "https://max.ru/-78241752722859";

// ── ХРАНИЛИЩЕ ──────────────────────────────────────────────
const STORE_FILE = new URL("./store.json", import.meta.url);
let store = {
    nextId: 1,
    items: [],
    activeForms: {},
    pendingContacts: {},
    knownUsers: {},
    ratings: {},
    starred: {}
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

// ── ВСПОМОГАТЕЛЬНЫЕ ────────────────────────────────────────
function userIdOf(ctx) {
    return ctx.user?.user_id ?? ctx.callback?.user?.user_id ??
           ctx.message?.sender?.user_id ?? ctx.from?.user_id ?? null;
}

function userNameOf(ctx) {
    return ctx.user?.name ?? ctx.callback?.user?.name ??
           ctx.message?.sender?.name ?? "друг";
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

function fmtBuyPrice(p) {
    return p === 0 ? "💰 Цена: любая / договорная" : `💰 Цена: до ${p} ₽`;
}

function ratingOf(uid) {
    const r = store.ratings?.[uid] || 0;
    return r > 0 ? ` ⭐${r}` : "";
}

function mainMenuKeyboard() {
    return Keyboard.inlineKeyboard([
        [Keyboard.button.callback("📦 Продать вещь", "menu:sell"), Keyboard.button.callback("🔍 Куплю", "menu:buy")],
        [Keyboard.button.callback("🛒 Смотреть объявления", "menu:catalog")],
        [Keyboard.button.callback("📋 Мои объявления", "menu:my_items"), Keyboard.button.callback("📢 Наш канал", "menu:channel")],
        [Keyboard.button.callback("❓ Помощь", "menu:help")]
    ]);
}

function cancelRow() {
    return [Keyboard.button.callback("❌ Отменить", "cancelform")];
}

async function replyPrivate(ctx, uid, text, opts = {}) {
    try {
        await bot.api.sendMessageToUser(uid, text, opts);
    } catch (e) {
        try { await ctx.reply(text, opts); } catch (e2) {
            console.log("⚠️  Не удалось ответить в личку: " + (e2?.message ?? e2));
        }
    }
}

async function notifyUser(uid, text, opts = { format: "markdown" }) {
    try {
        await bot.api.sendMessageToUser(uid, text, opts);
        return true;
    } catch (e) {
        console.log("⚠️  Не удалось уведомить пользователя " + uid);
        return false;
    }
}

async function sendToChannel(text, libAttachments) {
    if (!CHANNEL_ID) return false;
    try {
        await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: libAttachments });
        console.log("📢 Опубликовано в канале!");
        return true;
    } catch (e) { console.log("⚠️  С фото не вышло: " + (e?.message ?? e)); }
    try {
        const buttonsOnly = libAttachments.filter(a => a?.type !== "photo" && a?.type !== "image");
        await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: buttonsOnly });
        console.log("📢 Опубликовано в канале (без фото)!");
        return true;
    } catch (e) { console.log("⚠️  С кнопками не вышло: " + (e?.message ?? e)); }
    try {
        await bot.api.sendMessageToChat(CHANNEL_ID, text);
        console.log("📢 Опубликовано в канале (текст)!");
        return true;
    } catch (e) { console.log("⚠️  Текст не вышло: " + (e?.message ?? e)); }
    return false;
}

// ── ПРИВЕТСТВИЕ ────────────────────────────────────────────
async function sendWelcome(ctx, name) {
    const welcomeText = `Привет, ${name}! 👋\n\nЯ бот барахолки «У соседа» — Бояркино и окрестности.\nЗдесь соседи продают, покупают и меняются вещами.\n\nЧто хочешь сделать?`;
    await ctx.reply(welcomeText, { format: "markdown", attachments: [mainMenuKeyboard()] });
}

bot.command("start", async (ctx) => {
    const uid = userIdOf(ctx);
    if (store.activeForms[uid]) { delete store.activeForms[uid]; saveStore(); }
    store.knownUsers[uid] = true;
    saveStore();
    await sendWelcome(ctx, userNameOf(ctx));
});

// ── КНОПКА ОТМЕНЫ ──────────────────────────────────────────
bot.action(/^cancelform$/, async (ctx) => {
    const uid = userIdOf(ctx);
    if (store.activeForms[uid]) { delete store.activeForms[uid]; saveStore(); }
    await replyPrivate(ctx, uid, "❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenuKeyboard()] });
});

// ── МЕНЮ ───────────────────────────────────────────────────
bot.action(/^menu:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);

    // ПРОДАТЬ
    if (action === "sell") {
        store.activeForms[uid] = { type: "sell", step: "title", name: userNameOf(ctx), userId: uid, photos: [], createdAt: Date.now() };
        saveStore();
        await replyPrivate(ctx, uid,
            "📝 **Создание объявления**\n\n**Шаг 1 из 7:** Что продаёте?\n\n_Напиши название товара_",
            { format: "markdown", attachments: Keyboard.inlineKeyboard([cancelRow()]) });
        return;
    }

    // КУПЛЮ
    if (action === "buy") {
        store.activeForms[uid] = { type: "buy", step: "title", name: userNameOf(ctx), userId: uid, photos: [], createdAt: Date.now() };
        saveStore();
        await replyPrivate(ctx, uid,
            "🔍 **Объявление «Куплю»**\n\n**Шаг 1 из 5:** Что ищешь?\n\n_Напиши, что хочешь купить_",
            { format: "markdown", attachments: Keyboard.inlineKeyboard([cancelRow()]) });
        return;
    }

    // КАТАЛОГ
    if (action === "catalog") {
        const active = store.items.filter(i => i.status === "active").slice(-10);
        const backMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("🔙 Назад в меню", "menu:back")]]);
        if (active.length === 0) {
            return replyPrivate(ctx, uid, "Пока нет активных объявлений.\nСтань первым — нажми «Продать вещь»!", { format: "markdown", attachments: [backMenu] });
        }
        const rows = active.map(i => [Keyboard.button.callback(
            `${i.type === "buy" ? "🔍" : "📦"} №${i.id} ${String(i.title).slice(0, 22)} — ${i.type === "buy" ? (i.price ? "до " + i.price + " ₽" : "любая цена") : (i.price ? i.price + " ₽" : "даром")}`,
            `view:${i.id}`
        )]);
        rows.push([Keyboard.button.callback("🔙 Назад в меню", "menu:back")]);
        await replyPrivate(ctx, uid, "🛒 **Свежие объявления:**", { format: "markdown", attachments: [Keyboard.inlineKeyboard(rows)] });
        return;
    }

    // КАНАЛ
    if (action === "channel") {
        await replyPrivate(ctx, uid, `📢 **Наш канал «У соседа»:**\n\n${CHANNEL_LINK}\n\n_Подписывайся и делись с соседями!_`, { format: "markdown" });
        return;
    }

    // МОИ ОБЪЯВЛЕНИЯ
    if (action === "my_items") {
        const myItems = store.items.filter(item => item.sellerId === uid && item.status === "active");
        const backMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("🔙 Назад в меню", "menu:back")]]);
        if (myItems.length === 0) {
            return replyPrivate(ctx, uid, "У вас пока нет активных объявлений.", { format: "markdown", attachments: [backMenu] });
        }
        const lines = myItems.map(item => `${item.type === "buy" ? "🔍" : "📦"} №${item.id} — **${item.title}** — ${item.type === "buy" ? (item.price ? "до " + item.price + " ₽" : "любая цена") : fmtPrice(item.price)}`);
        await replyPrivate(ctx, uid, ["📋 **Ваши объявления:**", "", ...lines].join("\n"), { format: "markdown", attachments: [backMenu] });
        return;
    }

    // ПОМОЩЬ
    if (action === "help") {
        const backMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("🔙 Назад в меню", "menu:back")]]);
        await replyPrivate(ctx, uid,
            "❓ **Как пользоваться:**\n\n📦 **Продать:** 7 шагов → объявление в канале\n🔍 **Куплю:** 5 шагов → соседи увидят, что ты ищешь\n🛒 **Каталог:** все свежие объявления в боте\n⭐ **Спасибо:** оцени продавца после сделки\n📞 **Связь:** бот обменяет вас телефонами — просто позвоните!\n\nВещь можно отдать **даром** 🎁\nОтмена создания — кнопка «❌ Отменить»",
            { format: "markdown", attachments: [backMenu] });
        return;
    }

    // НАЗАД
    if (action === "back") {
        if (store.activeForms[uid]) { delete store.activeForms[uid]; saveStore(); }
        await replyPrivate(ctx, uid, "Главное меню:\n\nЧто хочешь сделать?", { format: "markdown", attachments: [mainMenuKeyboard()] });
        return;
    }
});

// ── ПРОСМОТР ОБЪЯВЛЕНИЯ ИЗ КАТАЛОГА ────────────────────────
bot.action(/^view:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const uid = userIdOf(ctx);
    const item = store.items.find(i => i.id === id);
    if (!item) return replyPrivate(ctx, uid, "Объявление не найдено.");

    const lines = [
        item.type === "buy" ? "🔍 **КУПЛЯ**" : "📦 **ОБЪЯВЛЕНИЕ**",
        "",
        `🏷️ **${item.title}**`,
        item.type === "buy" ? fmtBuyPrice(item.price) : `💰 **Цена:** ${fmtPrice(item.price)}`,
        `📝 **Описание:** ${item.description}`,
        `📍 **Где:** ${item.location}`,
        item.phone ? `📞 **Телефон:** ${item.phone}` : null,
        `👤 **${item.type === "buy" ? "Покупатель" : "Продавец"}:** ${item.sellerName}${ratingOf(item.sellerId)}`,
    ].filter(l => l !== null);

    const buttons = [
        [Keyboard.button.callback(item.type === "buy" ? "💬 Написать покупателю" : "💬 Написать продавцу", `contact:${item.id}`)],
    ];
    if (item.type === "sell") buttons.push([Keyboard.button.callback("⭐ Спасибо", `star:${item.id}`)]);
    buttons.push([Keyboard.button.callback("🔙 К списку", "menu:catalog")]);

    await replyPrivate(ctx, uid, lines.join("\n"), { format: "markdown", attachments: [Keyboard.inlineKeyboard(buttons)] });
});

// ── ЦЕНА: ДАРОМ / ЛЮБАЯ ────────────────────────────────────
bot.action(/^price:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    if (!store.activeForms[uid]) return;
    const form = store.activeForms[uid];

    if (action === "free" && form.type === "sell") {
        form.price = 0;
        form.step = "description";
        saveStore();
        await replyPrivate(ctx, uid,
            "✅ Цена: **🎁 Бесплатно / отдам даром**\n\n**Шаг 3 из 7:** Описание товара\n\n_Напиши состояние, комплектацию и другие детали_",
            { format: "markdown", attachments: Keyboard.inlineKeyboard([cancelRow()]) });
    }

    if (action === "any" && form.type === "buy") {
        form.price = 0;
        form.step = "location";
        saveStore();
        await replyPrivate(ctx, uid,
            "✅ Цена: **любая / договорная**\n\n**Шаг 3 из 5:** Где ты находишься?\n\n_Напиши деревню или СНТ_",
            { format: "markdown", attachments: Keyboard.inlineKeyboard([cancelRow()]) });
    }
});

// ── ТЕЛЕФОН: ПРОПУСТИТЬ ────────────────────────────────────
bot.action(/^phone:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    if (!store.activeForms[uid]) return;
    const form = store.activeForms[uid];

    if (action === "skip") {
        form.phone = null;
        if (form.type === "sell") {
            form.step = "photo";
            form.photos = form.photos || [];
            saveStore();
            const photoMenu = Keyboard.inlineKeyboard([
                [Keyboard.button.callback("✅ Готово, публиковать", "photo:done")],
                [Keyboard.button.callback("⏭️ Пропустить фото", "photo:skip")],
                cancelRow()
            ]);
            await replyPrivate(ctx, uid, "⏭️ Без телефона\n\n**Шаг 6 из 7:** Прикрепи фото товара\n\n_Можно несколько сразу (до 10). Когда закончишь — «✅ Готово»_", { format: "markdown", attachments: [photoMenu] });
        } else {
            form.step = "confirm";
            saveStore();
            await showConfirm(ctx, form, uid);
        }
    }
});

// ── ФОТО: ГОТОВО / ПРОПУСТИТЬ ──────────────────────────────
bot.action(/^photo:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    if (!store.activeForms[uid]) return;
    const form = store.activeForms[uid];

    if (action === "done" || action === "skip") {
        if (action === "skip") form.photos = [];
        form.step = "confirm";
        saveStore();
        await showConfirm(ctx, form, uid);
    }
});

async function showConfirm(ctx, form, uid) {
    const count = (form.photos || []).length;
    const total = form.type === "sell" ? 7 : 5;
    const confirmMenu = Keyboard.inlineKeyboard([
        [Keyboard.button.callback("✅ Опубликовать", "publish:yes")],
        [Keyboard.button.callback("❌ Отменить", "publish:no")]
    ]);
    const lines = [
        "**Предпросмотр:**", "",
        form.type === "buy" ? "🔍 **КУПЛЯ**" : "🏷️ **" + form.title + "**",
        form.type === "buy" ? `🏷️ Ищу: **${form.title}**` : `💰 **Цена:** ${fmtPrice(form.price)}`,
        form.type === "buy" ? fmtBuyPrice(form.price) : null,
        `📝 **Описание:** ${form.description}`,
        `📍 **Где:** ${form.location}`,
        `📞 **Телефон:** ${form.phone || "не указан"}`,
        form.type === "sell" ? `📷 **Фото:** ${count > 0 ? count + " шт." : "нет"}` : null,
        "",
        `**Шаг ${total} из ${total}:** Подтверди публикацию:`
    ].filter(l => l !== null);
    await replyPrivate(ctx, uid, lines.join("\n"), { format: "markdown", attachments: [confirmMenu] });
}

// ── СООБЩЕНИЯ ──────────────────────────────────────────────
bot.hears(/.*/, async (ctx) => {
    const uid = userIdOf(ctx);
    const text = getText(ctx);

    if (!store.activeForms[uid]) {

        // Покупатель оставляет свой телефон
        if (store.pendingContacts[uid] && text && typeof text === "string" && !text.startsWith("/")) {
            const pc = store.pendingContacts[uid];
            const item = store.items.find(i => i.id === pc.itemId);
            const digits = text.replace(/\D/g, "");
            if (item && digits.length >= 10) {
                delete store.pendingContacts[uid];
                saveStore();
                const who = item.type === "buy" ? "покупатель" : "продавец";
                await notifyUser(item.sellerId,
                    `🔔 **Отклик по объявлению!**\n\n${item.type === "buy" ? "📦 Кто-то продаёт то, что ты ищешь" : `📦 Объявление: «${item.title}»`}\n👤 ${item.type === "buy" ? "Откликнулся" : "Покупатель"}: ${pc.name}\n📞 Телефон: ${text.trim()}\n\n_Позвони или напиши!_`);
                let answer = `✅ Готово! ${who === "покупатель" ? "Покупатель" : "Продавец"} получил твой телефон и свяжется с тобой.`;
                if (item.phone) answer += `\n\n📞 Телефон ${who}а: ${item.phone}`;
                await ctx.reply(answer, { format: "markdown" });
                return;
            }
            await ctx.reply("⚠️ Это не похоже на телефон. Напиши номер с цифрами (например: 8-999-123-45-67)", { format: "markdown" });
            return;
        }

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

    // ФОТО (только продажа)
    if (form.step === "photo") {
        const photos = getPhotos(ctx);
        if (photos.length > 0) {
            form.photos = form.photos || [];
            form.photos.push(...photos);
            if (form.photos.length > 10) form.photos = form.photos.slice(0, 10);
            saveStore();
            const doneMenu = Keyboard.inlineKeyboard([
                [Keyboard.button.callback("✅ Готово, публиковать", "photo:done")],
                cancelRow()
            ]);
            await ctx.reply(`✅ Добавлено! Всего фото: **${form.photos.length}**\n\n_Пришли ещё или нажми «✅ Готово»_`, { format: "markdown", attachments: [doneMenu] });
            return;
        }
        if (text && typeof text === "string" && !text.startsWith("/")) {
            await ctx.reply("⚠️ Я не вижу фото. Пришли фотографию или нажми кнопку.", { format: "markdown" });
        }
        return;
    }

    if (typeof text === "string" && text.startsWith("/")) return;
    if (!text || typeof text !== "string") return;

    if (text.toLowerCase() === "отмена" || text.toLowerCase() === "отменить") {
        delete store.activeForms[uid];
        saveStore();
        await ctx.reply("❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenuKeyboard()] });
        return;
    }

    // ШАГ: НАЗВАНИЕ
    if (form.step === "title") {
        form.title = text.trim();
        form.step = "price";
        saveStore();
        if (form.type === "sell") {
            const priceMenu = Keyboard.inlineKeyboard([
                [Keyboard.button.callback("🎁 Отдам даром", "price:free")],
                cancelRow()
            ]);
            await ctx.reply(`✅ Название: **${form.title}**\n\n**Шаг 2 из 7:** Какая цена?\n\n_Напиши цену в рублях или нажми кнопку:_`, { format: "markdown", attachments: [priceMenu] });
        } else {
            const priceMenu = Keyboard.inlineKeyboard([
                [Keyboard.button.callback("💬 Любая цена", "price:any")],
                cancelRow()
            ]);
            await ctx.reply(`✅ Ищу: **${form.title}**\n\n**Шаг 2 из 5:** Сколько готов заплатить?\n\n_Напиши сумму или нажми «Любая цена»:_`, { format: "markdown", attachments: [priceMenu] });
        }
        return;
    }

    // ШАГ: ЦЕНА
    if (form.step === "price") {
        const price = parseInt(text.replace(/\D/g, ""));
        if (isNaN(price) || price <= 0) {
            return ctx.reply("❌ **Неверная цена!**\n\nНапиши числом (например: 5000) или нажми кнопку.", { format: "markdown" });
        }
        form.price = price;
        saveStore();
        if (form.type === "sell") {
            form.step = "description";
            await ctx.reply(`✅ Цена: **${form.price} ₽**\n\n**Шаг 3 из 7:** Описание товара\n\n_Напиши состояние, комплектацию и другие детали_`, { format: "markdown", attachments: Keyboard.inlineKeyboard([cancelRow()]) });
        } else {
            form.step = "location";
            await ctx.reply(`✅ Цена: **до ${form.price} ₽**\n\n**Шаг 3 из 5:** Где ты находишься?\n\n_Напиши деревню или СНТ_`, { format: "markdown", attachments: Keyboard.inlineKeyboard([cancelRow()]) });
        }
        return;
    }

    // ШАГ: ОПИСАНИЕ (только продажа)
    if (form.step === "description") {
        form.description = text.trim();
        form.step = "location";
        saveStore();
        await ctx.reply("✅ Описание сохранено\n\n**Шаг 4 из 7:** Где ты находишься?\n\n_Напиши деревню или СНТ (например: д. Бояркино или СНТ \"Берёзка\")_", { format: "markdown", attachments: Keyboard.inlineKeyboard([cancelRow()]) });
        return;
    }

    // ШАГ: МЕСТО
    if (form.step === "location") {
        form.location = text.trim();
        saveStore();
        if (form.type === "sell") {
            form.step = "phone";
            const phoneMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("⏭️ Пропустить", "phone:skip")], cancelRow()]);
            await ctx.reply(`✅ Место: **${form.location}**\n\n**Шаг 5 из 7:** Оставь телефон для связи\n\n_Покупатели смогут позвонить. Напиши номер или «Пропустить»_`, { format: "markdown", attachments: [phoneMenu] });
        } else {
            form.step = "phone";
            const phoneMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("⏭️ Пропустить", "phone:skip")], cancelRow()]);
            await ctx.reply(`✅ Место: **${form.location}**\n\n**Шаг 4 из 5:** Оставь телефон для связи\n\n_Напиши номер или «Пропустить»_`, { format: "markdown", attachments: [phoneMenu] });
        }
        return;
    }

    // ШАГ: ТЕЛЕФОН
    if (form.step === "phone") {
        const digits = text.replace(/\D/g, "");
        if (digits.length < 10) {
            return ctx.reply("⚠️ Это не похоже на телефон. Напиши номер с цифрами (например: 8-999-123-45-67) или нажми «Пропустить»", { format: "markdown" });
        }
        form.phone = text.trim();
        saveStore();
        if (form.type === "sell") {
            form.step = "photo";
            form.photos = form.photos || [];
            const photoMenu = Keyboard.inlineKeyboard([
                [Keyboard.button.callback("✅ Готово, публиковать", "photo:done")],
                [Keyboard.button.callback("⏭️ Пропустить фото", "photo:skip")],
                cancelRow()
            ]);
            await ctx.reply(`✅ Телефон: **${form.phone}**\n\n**Шаг 6 из 7:** Прикрепи фото товара\n\n_Можно несколько сразу (до 10). Когда закончишь — «✅ Готово»_`, { format: "markdown", attachments: [photoMenu] });
        } else {
            form.step = "confirm";
            saveStore();
            await showConfirm(ctx, form, uid);
        }
        return;
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

async function finalizeListing(ctx, form, uid) {
    const newItem = {
        id: store.nextId++,
        type: form.type,
        sellerId: form.userId,
        sellerName: form.name,
        title: form.title,
        price: form.price ?? 0,
        description: form.description || (form.type === "buy" ? "ищу " + form.title : ""),
        location: form.location || "не указано",
        phone: form.phone || null,
        photos: form.photos || [],
        status: "active",
        createdAt: Date.now(),
    };

    store.items.push(newItem);
    delete store.activeForms[uid];
    saveStore();

    const isBuy = newItem.type === "buy";
    const priceLine = isBuy ? fmtBuyPrice(newItem.price) : fmtPrice(newItem.price);

    const privateText = [
        isBuy ? "🔍 **ОБЪЯВЛЕНИЕ «КУПЛЮ»**" : "📦 **НОВОЕ ОБЪЯВЛЕНИЕ**",
        "",
        `🏷️ **${newItem.title}**`,
        isBuy ? `💰 **Цена:** ${priceLine}` : `💰 **Цена:** ${priceLine}`,
        `📝 **Описание:** ${newItem.description}`,
        `📍 **Где:** ${newItem.location}`,
        newItem.phone ? `📞 **Телефон:** ${newItem.phone}` : null,
        `👤 **${isBuy ? "Покупатель" : "Продавец"}:** ${newItem.sellerName}${ratingOf(newItem.sellerId)}`,
        "",
        `🆔 №${newItem.id}`
    ].filter(l => l !== null).join("\n");

    const channelText = [
        isBuy ? "🔍 КУПЛЯ" : "📦 НОВОЕ ОБЪЯВЛЕНИЕ",
        "",
        `🏷️ ${newItem.title}`,
        `💰 ${isBuy ? (newItem.price ? "Цена: до " + newItem.price + " ₽" : "Цена: любая / договорная") : "Цена: " + (newItem.price ? newItem.price + " ₽" : "Бесплатно / отдам даром")}`,
        `📝 Описание: ${newItem.description}`,
        `📍 Где: ${newItem.location}`,
        newItem.phone ? `📞 Звонить: ${newItem.phone}` : null,
        `👤 ${isBuy ? "Покупатель" : "Продавец"}: ${newItem.sellerName}${ratingOf(newItem.sellerId)}`,
        "",
        `🆔 №${newItem.id}`
    ].filter(l => l !== null).join("\n");

    const privateButtons = Keyboard.inlineKeyboard([
        [Keyboard.button.callback(isBuy ? "✅ Нашёл" : "✅ Продано", `sold:${newItem.id}`)]
    ]);

    const channelRows = [
        [Keyboard.button.callback(isBuy ? "💬 Написать покупателю" : "💬 Написать продавцу", `contact:${newItem.id}`)],
    ];
    if (!isBuy) channelRows.push([Keyboard.button.callback("⭐ Спасибо", `star:${newItem.id}`), Keyboard.button.callback("✅ Продано", `sold:${newItem.id}`)]);
    else channelRows.push([Keyboard.button.callback("✅ Нашёл", `sold:${newItem.id}`)]);
    channelRows.push([Keyboard.button.callback("📢 Подать объявление", "menu:sell")]);
    const channelButtons = Keyboard.inlineKeyboard(channelRows);

    try {
        await ctx.reply(privateText, { format: "markdown", attachments: [privateButtons] });
    } catch (err) {
        console.error("❌ Ошибка ответа продавцу:", err);
    }

    const withPhotos = [...newItem.photos, channelButtons];
    await sendToChannel(channelText, withPhotos);

    console.log(`✅ Создано объявление №${newItem.id} (${newItem.type}): ${newItem.title}`);
}

// ── НАПИСАТЬ ПРОДАВЦУ / ПОКУПАТЕЛЮ ─────────────────────────
bot.action(/^contact:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    const uid = userIdOf(ctx);
    const item = store.items.find(i => i.id === itemId);

    if (!item || item.status !== "active") {
        return replyPrivate(ctx, uid, "Это объявление уже не активно.");
    }

    const isBuy = item.type === "buy";
    let msg = `📦 **${item.title}**\n👤 ${isBuy ? "Покупатель" : "Продавец"}: ${item.sellerName}${ratingOf(item.sellerId)}\n📍 Где: ${item.location}\n`;
    if (item.phone) msg += `\n📞 **Телефон: ${item.phone}**\nМожно просто позвонить!\n`;
    msg += `\n_Чтобы ${isBuy ? "покупатель" : "продавец"} знал, кто интересуется, оставь свой телефон — я передам:_`;

    store.pendingContacts[uid] = { itemId, name: userNameOf(ctx) };
    saveStore();

    const noMenu = Keyboard.inlineKeyboard([[Keyboard.button.callback("⏭️ Не хочу", "contact:no")]]);
    await replyPrivate(ctx, uid, msg, { format: "markdown", attachments: [noMenu] });
});

bot.action(/^contact:no$/, async (ctx) => {
    const uid = userIdOf(ctx);
    const pc = store.pendingContacts[uid];
    delete store.pendingContacts[uid];
    saveStore();
    const item = pc ? store.items.find(i => i.id === pc.itemId) : null;
    let msg = "Хорошо! 🙂";
    if (item?.phone) msg += `\n\n📞 Телефон: ${item.phone}`;
    await replyPrivate(ctx, uid, msg, { format: "markdown" });
});

// ── СПАСИБО (РЕЙТИНГ) ──────────────────────────────────────
bot.action(/^star:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const uid = userIdOf(ctx);
    const item = store.items.find(i => i.id === id);
    if (!item) return;

    store.starred = store.starred || {};
    const arr = store.starred[id] || [];
    if (arr.includes(uid)) {
        return replyPrivate(ctx, uid, "Ты уже говорил спасибо этому продавцу! 🙂", { format: "markdown" });
    }
    arr.push(uid);
    store.starred[id] = arr;
    store.ratings = store.ratings || {};
    store.ratings[item.sellerId] = (store.ratings[item.sellerId] || 0) + 1;
    saveStore();

    await replyPrivate(ctx, uid, `⭐ Спасибо передано! У ${item.sellerName} теперь ⭐${store.ratings[item.sellerId]}`, { format: "markdown" });
    await notifyUser(item.sellerId, `⭐ Тебе спасибо за объявление «${item.title}»!\nТвой рейтинг: ⭐${store.ratings[item.sellerId]}`);
});

// ── ПРОДАНО / НАШЁЛ ────────────────────────────────────────
bot.action(/^sold:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    const uid = userIdOf(ctx);
    const item = store.items.find(i => i.id === itemId);

    if (!item) return;
    if (item.sellerId !== uid) {
        return replyPrivate(ctx, uid, "Это не ваше объявление!");
    }

    item.status = "sold";
    saveStore();

    await replyPrivate(ctx, uid,
        item.type === "buy" ? `✅ Объявление №${itemId} отмечено: нашёл! Поздравляю! 🎉` : `✅ Объявление №${itemId} отмечено как проданное! Поздравляю! 🎉`,
        { format: "markdown" });
});

// ── НАПОМИНАНИЕ ЧЕРЕЗ 7 ДНЕЙ ───────────────────────────────
function checkReminders() {
    const now = Date.now();
    for (const item of store.items) {
        if (item.status === "active" && !item.reminded && now - item.createdAt > 7 * 24 * 3600 * 1000) {
            item.reminded = true;
            saveStore();
            const buttons = Keyboard.inlineKeyboard([
                [Keyboard.button.callback("✅ Да, оставить", `remind:yes:${item.id}`)],
                [Keyboard.button.callback("❌ Уже продал / не нужно", `remind:no:${item.id}`)]
            ]);
            notifyUser(item.sellerId,
                `⏰ Привет! Объявление «${item.title}» висит уже 7 дней.\n\nЕщё актуально?`,
                { format: "markdown", attachments: [buttons] });
            console.log(`⏰ Напоминание по объявлению №${item.id}`);
        }
    }
}

bot.action(/^remind:(yes|no):(\d+)$/, async (ctx) => {
    const [, answer, idStr] = ctx.match;
    const id = Number(idStr);
    const item = store.items.find(i => i.id === id);
    if (!item) return;

    if (answer === "yes") {
        item.createdAt = Date.now();
        item.reminded = false;
        saveStore();
        await replyPrivate(ctx, uidOf(ctx), "Отлично! Объявление остаётся в канале ещё на 7 дней. 🙌", { format: "markdown" });
    } else {
        item.status = "sold";
        saveStore();
        await replyPrivate(ctx, uidOf(ctx), "✅ Объявление снято с публикации. Удачи! 🍀", { format: "markdown" });
    }
});

// ── ВЕБ-СЕРВЕР ─────────────────────────────────────────────
const http = await import("node:http");
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Барахолка «У соседа» работает! ✅");
}).listen(port, () => {
    console.log("🌐 Веб-сервер запущен на порту " + port);
});

// ── ЗАПУСК ─────────────────────────────────────────────────
process.on("unhandledRejection", (err) => {
    console.error("⚠️ Ошибка:", err);
});

console.log("🚀 Барахолка «У соседа» (Бояркино) — полная версия запускается…");
checkReminders();
setInterval(checkReminders, 60 * 60 * 1000);
bot.start();
