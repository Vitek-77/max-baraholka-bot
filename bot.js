// ============================================================
//  🛒 БАРАХОЛКА-БОТ для мессенджера MAX
//  Версия с автоприветствием
// ============================================================

import { Bot, Keyboard } from "@maxhub/max-bot-api";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── НАСТРОЙКИ ──────────────────────────────────────────────
const TOKEN = process.env.BOT_TOKEN;
const OWNER_IDS = [];

// ── ХРАНИЛИЩЕ ──────────────────────────────────────────────
const STORE_FILE = new URL("./store.json", import.meta.url);
let store = { 
    ownerId: null, 
    channelId: null, 
    nextId: 1, 
    items: [],
    activeForms: {},
    knownUsers: {} // Храним ID пользователей, которые уже видели приветствие
};

if (existsSync(STORE_FILE)) {
    try {
        store = { ...store, ...JSON.parse(readFileSync(STORE_FILE, "utf8")) };
        console.log("📁 Загружено сохранение барахолки");
    } catch {
        console.warn("️  store.json повреждён");
    }
}

const saveStore = () => {
    writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
};

const bot = new Bot(TOKEN);

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ───────────────────────────────
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
    if (ctx.text && typeof ctx.text === "string") {
        return ctx.text;
    }
    if (ctx.message?.text && typeof ctx.message.text === "string") {
        return ctx.message.text;
    }
    if (ctx.message?.body?.text && typeof ctx.message.body.text === "string") {
        return ctx.message.body.text;
    }
    if (ctx.body?.text && typeof ctx.body.text === "string") {
        return ctx.body.text;
    }
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

// ── ФУНКЦИЯ ПРИВЕТСТВИЯ ────────────────────────────────────
async function sendWelcome(ctx, name) {
    const welcomeText = `Привет, ${name}! 👋\n\nЯ бот «Барахолка» — помогу продать или купить вещи.\n\nЧто хочешь сделать?`;
    
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

// ── ГЛАВНОЕ МЕНЮ ──────────────────────────────────────────

bot.command("start", async (ctx) => {
    const uid = userIdOf(ctx);
    const name = userNameOf(ctx);
    
    if (store.activeForms[uid]) {
        delete store.activeForms[uid];
        saveStore();
    }
    
    // Помечаем пользователя как знакомого
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
            "📝 **Создание объявления**\n\n**Шаг 1 из 5:** Что продаёте?\n\n_Напиши название товара_",
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
            "❓ **Как пользоваться ботом:**\n\n1️⃣ Нажми «Продать вещь»\n2️⃣ Ответь на вопросы бота\n3️⃣ Прикрепи фото товара\n4️⃣ Бот создаст красивое объявление\n5️⃣ Покупатели смогут связаться с тобой\n\nМожно отменить создание, написав `/отмена`",
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
            [Keyboard.button.callback(" Продать вещь", "menu:sell")],
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

// ── ОБРАБОТКА ВСЕХ СООБЩЕНИЙ ──────────────────────────────

bot.hears(/.*/, async (ctx) => {
    const uid = userIdOf(ctx);
    const text = getText(ctx);
    const photo = getPhoto(ctx);
    
    // Если пользователь НЕ в процессе заполнения формы
    if (!store.activeForms[uid]) {
        // Если это новый пользователь (не в knownUsers) — показываем приветствие
        if (!store.knownUsers[uid]) {
            const name = userNameOf(ctx);
            store.knownUsers[uid] = true;
            saveStore();
            await sendWelcome(ctx, name);
            return;
        }
        
        // Если пользователь уже знакомый — показываем меню
        const mainMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("📦 Продать вещь", "menu:sell")],
            [Keyboard.button.callback("📋 Мои объявления", "menu:my_items")],
            [Keyboard.button.callback("❓ Помощь", "menu:help")]
        ]);
        
        await ctx.reply("Используй кнопки ниже ", { 
            format: "markdown", 
            attachments: [mainMenu] 
        });
        return;
    }
    
    const form = store.activeForms[uid];
    
    // Обработка фото на шаге 4
    if (form.step === "photo" && photo) {
        form.photo = photo;
        form.step = "confirm";
        saveStore();
        
        const confirmMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("✅ Опубликовать", "publish:yes")],
            [Keyboard.button.callback("❌ Отменить", "publish:no")]
        ]);
        
        await ctx.reply(
            `✅ Фото получено!\n\n**Предпросмотр объявления:**\n\n🏷️ **${form.title}**\n💰 **Цена:** ${form.price} ₽\n📝 **Описание:** ${form.description}\n📷 **Фото:** прикреплено\n\n**Шаг 5 из 5:** Подтверди публикацию:`,
            { format: "markdown", attachments: [confirmMenu] }
        );
        return;
    }
    
    if (typeof text === "string" && text.startsWith("/")) return;
    if (!text || typeof text !== "string") return;
    
    // Шаг 1: Название
    if (form.step === "title") {
        form.title = text.trim();
        form.step = "price";
        saveStore();
        
        await ctx.reply(
            `✅ Название: **${form.title}**\n\n**Шаг 2 из 5:** Какая цена?\n\n_Напиши цену в рублях (например: 5000)_`,
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
            `✅ Цена: **${form.price} ₽**\n\n**Шаг 3 из 5:** Описание товара\n\n_Напиши состояние, комплектацию и другие детали_`,
            { format: "markdown" }
        );
        return;
    }
    
    // Шаг 3: Описание
    if (form.step === "description") {
        form.description = text.trim();
        form.step = "photo";
        saveStore();
        
        const skipPhotoMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback("⏭️ Пропустить фото", "photo:skip")]
        ]);
        
        await ctx.reply(
            `✅ Описание сохранено\n\n**Шаг 4 из 5:** Прикрепи фото товара\n\n_Отправь фотографию или нажми кнопку ниже, чтобы пропустить_`,
            { format: "markdown", attachments: [skipPhotoMenu] }
        );
        return;
    }
    
    if (form.step === "photo") {
        await ctx.reply(
            "⚠️ Я не вижу фото. Пожалуйста, отправь фотографию товара или нажми кнопку «Пропустить фото»",
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
            `⏭️ Фото пропущено\n\n**Предпросмотр объявления:**\n\n🏷️ **${form.title}**\n💰 **Цена:** ${form.price} ₽\n📝 **Описание:** ${form.description}\n📷 **Фото:** нет\n\n**Шаг 5 из 5:** Подтверди публикацию:`,
            { format: "markdown", attachments: [confirmMenu] }
        );
    }
});

// ── КНОПКИ ПОДТВЕРЖДЕНИЯ / ОТМЕНЫ ────────────────────────

bot.action(/^publish:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const uid = userIdOf(ctx);
    
    if (action === "no") {
        if (store.activeForms[uid]) {
            delete store.activeForms[uid];
            saveStore();
        }
        
        const mainMenu = Keyboard.inlineKeyboard([
            [Keyboard.button.callback(" Продать вещь", "menu:sell")],
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

// ── ФИНАЛИЗАЦИЯ ОБЪЯВЛЕНИЯ С ФОТО ──────────────────────────

async function finalizeListing(ctx, form, uid) {
    const newItem = {
        id: store.nextId++,
        sellerId: form.userId,
        sellerName: form.name,
        title: form.title,
        price: form.price,
        description: form.description,
        photo: form.photo || null,
        status: "active",
        createdAt: Date.now(),
    };
    
    store.items.push(newItem);
    delete store.activeForms[uid];
    saveStore();
    
    let messageText = [
        "📦 **НОВОЕ ОБЪЯВЛЕНИЕ**",
        "",
        `🏷️ **${newItem.title}**`,
        `💰 **Цена:** ${newItem.price} ₽`,
        ` **Описание:** ${newItem.description}`,
        `👤 **Продавец:** ${newItem.sellerName}`,
        "",
        ` №${newItem.id}`
    ].join("\n");
    
    if (newItem.photo) {
        messageText += "\n\n **Фото:** прикреплено";
    }
    
    const itemButtons = Keyboard.inlineKeyboard([
        [Keyboard.button.callback("💬 Написать продавцу", `contact:${newItem.id}`)],
        [Keyboard.button.callback("✅ Продано", `sold:${newItem.id}`)],
        [Keyboard.button.callback("🔙 В главное меню", "menu:back")]
    ]);
    
    const attachments = [itemButtons];
    
    if (newItem.photo && typeof newItem.photo === "object") {
        attachments.unshift(newItem.photo);
    }
    
    try {
        await ctx.reply(messageText, { 
            format: "markdown",
            attachments: attachments
        });
        
        console.log(`✅ Создано объявление №${newItem.id}: ${newItem.title}`);
        
    } catch (err) {
        console.error("❌ Ошибка:", err);
        await ctx.reply("❌ Не удалось опубликовать объявление.");
    }
}

// ── КНОПКИ ПОД ОБЪЯВЛЕНИЯМИ ────────────────────────────────

bot.action(/^contact:(\d+)$/, async (ctx) => {
    const itemId = Number(ctx.match[1]);
    const item = store.items.find(i => i.id === itemId);
    
    if (!item || item.status === "sold") {
        return ctx.reply("Это объявление уже не активно.");
    }
    
    const backMenu = Keyboard.inlineKeyboard([
        [Keyboard.button.callback("🔙 Назад в меню", "menu:back")]
    ]);
    
    await ctx.reply(
        ` **Связь с продавцом**\n\nТовар: **${item.title}**\nПродавец: ${item.sellerName}\nID продавца: \`${item.sellerId}\`\n\n_Напиши продавцу в личные сообщения_`,
        { format: "markdown", attachments: [backMenu] }
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
    
    const backMenu = Keyboard.inlineKeyboard([
        [Keyboard.button.callback("🔙 Назад в меню", "menu:back")]
    ]);
    
    await ctx.reply(
        `✅ Объявление №${itemId} отмечено как проданное!`,
        { format: "markdown", attachments: [backMenu] }
    );
});

// ── ЗАПУСК ─────────────────────────────────────────────────

process.on("unhandledRejection", (err) => {
    console.error("⚠️ Ошибка:", err);
});

console.log("🚀 Барахолка-бот запускается…");
console.log("   Отправьте боту /start в MAX для проверки.");
bot.start();
