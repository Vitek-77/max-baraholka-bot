// ============================================================
//  🛒 БАРАХОЛКА "У СОСЕДА" — Бояркино и окрестности
// ============================================================

import { Bot, Keyboard } from "@maxhub/max-bot-api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── НАСТРОЙКИ ──────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN;

// ID канала, куда бот публикует объявления
const CHANNEL_ID = -78241752722859;

// ── ХРАНИЛИЩЕ ──────────────────────────────────────────────
const STORE_FILE = new URL("./store.json", import.meta.url);
let store = { 
    ownerId: null, 
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

function getPhoto(ctx) {
    if (ctx.message?.photo) return ctx.message.photo;
    if (ctx.message?.attachments) {
        const photo = ctx.message.attachments.find(a => a.type === "photo" || a.type === "image");
        if (photo) return photo;
    }
    if (ctx.photo) return ctx.photo;
    if (ctx.message?.body?.attachments) {
        const photo = ctx.message.body.attachments.find(a => a.type === "photo" || a.type === "image");
        if (photo) return photo;
    }
    return null;
}

// ── ОТПРАВКА В КАНАЛ (ТОЧНАЯ сигнатура библиотеки) ─────────
async function sendToChannel(text, libAttachments) {
    if (!CHANNEL_ID) {
        console.log("⚠️  Канал не подключён");
        return false;
    }

    // Попытка 1: с фото и кнопками
    try {
        await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: libAttachments });
        console.log("📢 Опубликовано в канале (фото + кнопки)!");
        return true;
    } catch (e) {
        console.log("⚠️  С фото не вышло: " + (e?.message ?? e));
    }

    // Попытка 2: только кнопки (без фото)
    try {
        const buttonsOnly = libAttachments.filter(a => a?.type !== "photo" && a?.type !== "image");
        await bot.api.sendMessageToChat(CHANNEL_ID, text, { attachments: buttonsOnly });
        console.log("📢 Опубликовано в канале (кнопки, без фото)!");
        return true;
    } catch (e) {
        console.log("⚠️  С кнопками не вышло: " + (e?.message ?? e));
    }

    // Попытка 3: только текст
    try {
        await bot.api.sendMessageToChat(CHANNEL_ID, text);
        console.log("📢 Опубликовано в канале (текст)!");
        return true;
    } catch (e) {
        console.log("⚠️  Текст не вышло: " + (e?.message ?? e));
    }

    return false;
}

// ── ПРИВЕТСТВИЕ ────────────────────────────────────────────
async function sendWelcome(ctx, name) {
    const welcomeText = `Привет, ${name}! 👋\n\nЯ бот барахолки «У соседа» — Бояркино и окрестности.\nЗдесь соседи продают, покупают и меняются вещами.\n\nЧто хочешь сделать?`;
    
    const mainMenu = Keyboard.inlineKeyboard([
        [Keyboard.button.callback("📦 Продать вещь", "menu:sell")],
        [Keyboard.button.callback("📋 Мои объявления", "menu:my_items")],
        [Keyboard.button.callback("❓ Помощь", "menu:help")]
    ]);
    
    await ctx.reply(welcomeText, { 
        format: "markdown",
        attachments: [mainMenu]
    });
}

bot.command("start", async (ctx) => {
    const uid = userIdOf(ctx);
    const name = userNameOf(ctx);
    
    if (store.activeForms[uid]) {
        delete store.activeForms[uid];
        saveStore();
    }
    
    store.knownUsers[uid] = true;
    saveStore();
    
    await sendWelcome(ctx, name);
});

// ── ОБРАБОТКА КНОПОК МЕНЮ ──────────────────────────────────

bot.action(/^menu:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    const name = userNameOf(ctx);
    
    if (action === "sell") {
        store.activeForms[uid] = {
            step: "title",
            name: name,
            userId: uid,
            createdAt: Date.now()
        };
        saveStore();
        
        await ctx.reply(
            "📝 **Создание объявления**\n\n**Шаг 1 из 6:** Что продаёте?\n\n_Напиши название товара_",
            { format: "markdown" }
        );
        return;
    }
    
    if (action === "my_items") {
        const myItems = store.items.filter(item => item.sellerId === uid && item.status === "active");
        const backMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("🔙 Назад в меню", "menu:back")]
        ]);
        
        if (myItems.length === 0) {
            return ctx.reply(
                "У вас пока нет активных объявлений.\n\nНажмите кнопку ниже, чтобы вернуться в меню.",
                { format: "markdown", attachments: [backMenu] }
            );
        }
        
        const lines = myItems.map(item => `№${item.id} — **${item.title}** за ${item.price} ₽`);
        await ctx.reply(
            ["📋 **Ваши объявления:**", "", ...lines].join("\n"),
            { format: "markdown", attachments: [backMenu] }
        );
        return;
    }
    
    if (action === "help") {
        const backMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("🔙 Назад в меню", "menu:back")]
        ]);
        
        await ctx.reply(
            "❓ **Как пользоваться:**\n\n1️⃣ Нажми «Продать вещь»\n2️⃣ Ответь на 6 вопросов бота\n3️⃣ Объявление появится в канале «У соседа»\n4️⃣ Соседи увидят его и смогут написать тебе\n\nОтменить создание можно, написав `/отмена`",
            { format: "markdown", attachments: [backMenu] }
        );
        return;
    }
    
    if (action === "back") {
        if (store.activeForms[uid]) {
            delete store.activeForms[uid];
            saveStore();
        }
        
        const mainMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("📦 Продать вещь", "menu:sell")],
            [Keyboard.button.callback("📋 Мои объявления", "menu:my_items")],
            [Keyboard.button.callback("❓ Помощь", "menu:help")]
        ]);
        
        await ctx.reply("Главное меню:\n\nЧто хочешь сделать?", { 
            format: "markdown", 
            attachments: [mainMenu] 
        });
        return;
    }
});

// ── ОБРАБОТКА ВСЕХ СООБЩЕНИЙ ───────────────────────────────

bot.hears(/.*/, async (ctx) => {
    const uid = userIdOf(ctx);
    const text = getText(ctx);
    const photo = getPhoto(ctx);
    
    if (!store.activeForms[uid]) {
        if (!store.knownUsers[uid]) {
            const name = userNameOf(ctx);
            store.knownUsers[uid] = true;
            saveStore();
            await sendWelcome(ctx, name);
            return;
        }
        
        const mainMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("📦 Продать вещь", "menu:sell")],
            [Keyboard.button.callback("📋 Мои объявления", "menu:my_items")],
            [Keyboard.button.callback("❓ Помощь", "menu:help")]
        ]);
        
        await ctx.reply("Используй кнопки ниже 👇", { 
            format: "markdown", 
            attachments: [mainMenu] 
        });
        return;
    }
    
    const form = store.activeForms[uid];
    
    // Шаг 5: Фото
    if (form.step === "photo" && photo) {
        form.photo = photo;
        form.step = "confirm";
        saveStore();
        
        const confirmMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("✅ Опубликовать", "publish:yes")],
            [Keyboard.button.callback("❌ Отменить", "publish:no")]
        ]);
        
        await ctx.reply(
            `✅ Фото получено!\n\n**Предпросмотр:**\n\n🏷️ **${form.title}**\n💰 **Цена:** ${form.price} ₽\n📝 **Описание:** ${form.description}\n📍 **Где:** ${form.location}\n📷 **Фото:** есть\n\n**Шаг 6 из 6:** Подтверди публикацию:`,
            { format: "markdown", attachments: [confirmMenu] }
        );
        return;
    }
    
    if (typeof text === "string" && text.startsWith("/")) return;
    if (!text || typeof text !== "string") return;
    
    // Отмена
    if (text.toLowerCase() === "отмена") {
        delete store.activeForms[uid];
        saveStore();
        const mainMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("📦 Продать вещь", "menu:sell")],
            [Keyboard.button.callback("📋 Мои объявления", "menu:my_items")],
            [Keyboard.button.callback("❓ Помощь", "menu:help")]
        ]);
        await ctx.reply("❌ Создание объявления отменено.", { format: "markdown", attachments: [mainMenu] });
        return;
    }
    
    // Шаг 1: Название
    if (form.step === "title") {
        form.title = text.trim();
        form.step = "price";
        saveStore();
        
        await ctx.reply(
            `✅ Название: **${form.title}**\n\n**Шаг 2 из 6:** Какая цена?\n\n_Напиши цену в рублях (например: 5000)_`,
            { format: "markdown" }
        );
        return;
    }
    
    // Шаг 2: Цена
    if (form.step === "price") {
        const price = parseInt(text.replace(/\D/g, ""));
        
        if (isNaN(price) || price <= 0) {
            return ctx.reply(
                "❌ **Неверная цена!**\n\nПожалуйста, напиши цену числом (например: 5000)",
                { format: "markdown" }
            );
        }
        
        form.price = price;
        form.step = "description";
        saveStore();
        
        await ctx.reply(
            `✅ Цена: **${form.price} ₽**\n\n**Шаг 3 из 6:** Описание товара\n\n_Напиши состояние, комплектацию и другие детали_`,
            { format: "markdown" }
        );
        return;
    }
    
    // Шаг 3: Описание
    if (form.step === "description") {
        form.description = text.trim();
        form.step = "location";
        saveStore();
        
        await ctx.reply(
            `✅ Описание сохранено\n\n**Шаг 4 из 6:** Где ты находишься?\n\n_Напиши деревню или СНТ (например: д. Бояркино или СНТ "Берёзка")_`,
            { format: "markdown" }
        );
        return;
    }
    
    // Шаг 4: Местоположение
    if (form.step === "location") {
        form.location = text.trim();
        form.step = "photo";
        saveStore();
        
        const skipPhotoMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("⏭️ Пропустить фото", "photo:skip")]
        ]);
        
        await ctx.reply(
            `✅ Место: **${form.location}**\n\n**Шаг 5 из 6:** Прикрепи фото товара\n\n_Отправь фотографию или нажми кнопку, чтобы пропустить_`,
            { format: "markdown", attachments: [skipPhotoMenu] }
        );
        return;
    }
    
    if (form.step === "photo") {
        await ctx.reply(
            "⚠️ Я не вижу фото. Отправь фотографию товара или нажми кнопку «Пропустить фото»",
            { format: "markdown" }
        );
        return;
    }
});

// ── КНОПКА ПРОПУСКА ФОТО ───────────────────────────────────

bot.action(/^photo:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    
    if (action === "skip" && store.activeForms[uid]) {
        const form = store.activeForms[uid];
        form.photo = null;
        form.step = "confirm";
        saveStore();
        
        const confirmMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("✅ Опубликовать", "publish:yes")],
            [Keyboard.button.callback("❌ Отменить", "publish:no")]
        ]);
        
        await ctx.reply(
            `⏭️ Фото пропущено\n\n**Предпросмотр:**\n\n🏷️ **${form.title}**\n💰 **Цена:** ${form.price} ₽\n📝 **Описание:** ${form.description}\n📍 **Где:** ${form.location}\n\n**Шаг 6 из 6:** Подтверди публикацию:`,
            { format: "markdown", attachments: [confirmMenu] }
        );
    }
});

// ── ПОДТВЕРЖДЕНИЕ / ОТМЕНА ─────────────────────────────────

bot.action(/^publish:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    
    if (action === "no") {
        if (store.activeForms[uid]) {
            delete store.activeForms[uid];
            saveStore();
        }
        
        const mainMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("📦 Продать вещь", "menu:sell")],
            [Keyboard.button.callback("📋 Мои объявления", "menu:my_items")],
            [Keyboard.button.callback("❓ Помощь", "menu:help")]
        ]);
        
        return ctx.reply("❌ Создание объявления отменено.", { 
            format: "markdown", 
            attachments: [mainMenu] 
        });
    }
    
    if (action === "yes" && store.activeForms[uid]) {
        const form = store.activeForms[uid];
        await finalizeListing(ctx, form, uid);
    }
});

// ── ФИНАЛИЗАЦИЯ ОБЪЯВЛЕНИЯ ─────────────────────────────────

async function finalizeListing(ctx, form, uid) {
    const newItem = {
        id: store.nextId++,
        sellerId: form.userId,
        sellerName: form.name,
        title: form.title,
        price: form.price,
        description: form.description,
        location: form.location || "не указано",
        photo: form.photo || null,
        status: "active",
        createdAt: Date.now(),
    };
    
    store.items.push(newItem);
    delete store.activeForms[uid];
    saveStore();
    
    // Текст для продавца (в личку)
    const privateText = [
        "📦 **НОВОЕ ОБЪЯВЛЕНИЕ**",
        "",
        `🏷️ **${newItem.title}**`,
        `💰 **Цена:** ${newItem.price} ₽`,
        `📝 **Описание:** ${newItem.description}`,
        `📍 **Где:** ${newItem.location}`,
        `👤 **Продавец:** ${newItem.sellerName}`,
        "",
        `🆔 №${newItem.id}`
    ].join("\n");
    
    // Текст для канала (без markdown)
    const channelText = [
        "📦 НОВОЕ ОБЪЯВЛЕНИЕ",
        "",
        `🏷️ ${newItem.title}`,
        `💰 Цена: ${newItem.price} ₽`,
        `📝 Описание: ${newItem.description}`,
        `📍 Где: ${newItem.location}`,
        `👤 Продавец: ${newItem.sellerName}`,
        "",
        `🆔 №${newItem.id}`
    ].join("\n");
    
    const itemButtons = Keyboard.inlineKeyboard([
        [Keyboard.button.callback("💬 Написать продавцу", `contact:${newItem.id}`)],
        [Keyboard.button.callback("✅ Продано", `sold:${newItem.id}`)]
    ]);
    
    // Отвечаем продавцу в личку
    try {
        await ctx.reply(privateText, { 
            format: "markdown",
            attachments: [itemButtons]
        });
    } catch (err) {
        console.error("❌ Ошибка ответа продавцу:", err);
    }
    
    // Публикуем в канал (с фото; если фото не пройдёт — сами уберётся)
    const withPhoto = [itemButtons];
    if (newItem.photo && typeof newItem.photo === "object") {
        withPhoto.unshift(newItem.photo);
    }
    
    await sendToChannel(channelText, withPhoto);
    
    console.log(`✅ Создано объявление №${newItem.id}: ${newItem.title}`);
}

// ── КНОПКИ ПОД ОБЪЯВЛЕНИЯМИ ────────────────────────────────

bot.action(/^contact:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    const item = store.items.find(i => i.id === itemId);
    
    if (!item || item.status === "sold") {
        return ctx.reply("Это объявление уже не активно.");
    }
    
    await ctx.reply(
        `📞 **Связь с продавцом**\n\nТовар: **${item.title}**\n📍 Где: ${item.location}\nПродавец: ${item.sellerName}\nID продавца: \`${item.sellerId}\`\n\n_Напиши продавцу в личные сообщения в MAX_`,
        { format: "markdown" }
    );
});

bot.action(/^sold:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    const uid = userIdOf(ctx);
    const item = store.items.find(i => i.id === itemId);
    
    if (!item) return;
    if (item.sellerId !== uid) {
        return ctx.reply("Это не ваше объявление!");
    }
    
    item.status = "sold";
    saveStore();
    
    await ctx.reply(
        `✅ Объявление №${itemId} отмечено как проданное!`,
        { format: "markdown" }
    );
});

// ── ВЕБ-СЕРВЕР (чтобы Render не усыплял бота) ──────────────
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

console.log("🚀 Барахолка «У соседа» (Бояркино) запускается…");
bot.start();
