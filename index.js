const fs            = require('fs');
const path          = require('path');
const TelegramBot   = require('node-telegram-bot-api');
const cron          = require('node-cron');
const moment        = require('moment-jalaali');

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

const token = "7972229213:AAFi1xooCGC8L5sOMvi83zXDaS5ZD6aVk_U";
if (!token) {
  console.error('❌ لطفا در فایل .env متغیر BOT_TOKEN را تنظیم کنید.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const DATA_DIR   = __dirname;
const SUBS_FILE  = path.join(DATA_DIR, 'subscribers.json');
const RES_FILE   = path.join(DATA_DIR, 'reservations.json');

let subscribers  = [];
let reservations = {};

const MENU = {
  Saturday:  'قرمه سبزی',
  Sunday:    'قیمه',
  Monday:    'شینسل مرغ',
  Tuesday:   'الویه',
  Wednesday: 'کباب تابه ای',
  Thursday:  '----',
  Friday:    '----'
};

function loadData() {
  try { subscribers = JSON.parse(fs.readFileSync(SUBS_FILE)); }
  catch { subscribers = []; fs.writeFileSync(SUBS_FILE, JSON.stringify(subscribers, null,2)); }
  try { reservations = JSON.parse(fs.readFileSync(RES_FILE)); }
  catch { reservations = {}; fs.writeFileSync(RES_FILE, JSON.stringify(reservations, null,2)); }
}

function saveData() {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subscribers, null,2));
  fs.writeFileSync(RES_FILE,  JSON.stringify(reservations, null,2));
}

loadData();

function isCoolingTime() {
  const hour = moment().hour();
  return hour >= 10 && hour < 19;
}

function getTargetDay() {
  const target = moment().add(1, 'day');
  return {
    key:     target.locale('en').format('dddd'),
    display: target.format('dddd')
  };
}

function getFormattedDateTime() {
  const now  = moment();
  const date = now.format('jYYYY/jMM/jDD');
  const time = now.format('HH:mm:ss');
  return `تاریخ: ${date}    ساعت: ${time}`;
}

function broadcast(text) {
  subscribers.forEach(chatId => {
    bot.sendMessage(chatId, text).catch(err => {
      if (err.response && err.response.statusCode === 403) {
        subscribers = subscribers.filter(id => id !== chatId);
        saveData();
      }
    });
  });
}

function reserveMeal(chatId, name) {
  const { key } = getTargetDay();
  if (!MENU[key] || MENU[key].startsWith('----')) return false;
  reservations[key] = reservations[key] || [];
  if (reservations[key].some(u => u.id === chatId)) return 'exists';
  reservations[key].push({ id: chatId, name });
  saveData();
  return true;
}

function cancelReservation(chatId) {
  const { key } = getTargetDay();
  if (!reservations[key]) return false;
  const before = reservations[key].length;
  reservations[key] = reservations[key].filter(u => u.id !== chatId);
  saveData();
  return reservations[key].length < before;
}

function listReservations() {
  const { key } = getTargetDay();
  return reservations[key] || [];
}

bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;
  const helpText = `👋 خوش آمدید!

شما می‌توانید:
• /subscribe — عضویت پیام‌های کولر
• /unsubscribe — لغو اشتراک
• بخش کولر: هر ساعت ۱۵ دقیقه اول روشن، ۱۵ دقیقه بعد خاموش (10-19)
• /menu — منوی فردا و رزرو
• /myreserve — وضعیت رزرو فردا
• /reservations — لیست رزروهای فردا
• /reserved — نمایش کلی رزروها
• /help — راهنما`;
  bot.sendMessage(chatId, helpText, {
    reply_markup: {
      keyboard: [
        ['/subscribe', '/unsubscribe'],
        ['/menu', '/myreserve', '/reservations'],
        ['/reserved', '/help']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  });
});

bot.onText(/\/help/, msg => {
  const chatId = msg.chat.id;
  const text = `📖 *راهنمای ربات*:

*بخش کولر* (فعال: 10 تا 19 هر ساعت)
• /subscribe — عضویت
• /unsubscribe — لغو اشتراک

*بخش غذا*:
• /menu — منوی فردا و رزرو
• /myreserve — وضعیت رزرو فردا
• /reservations — لیست رزروهای فردا
• /reserved — نمایش کلی رزروها`;
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/subscribe/, msg => {
  const chatId = msg.chat.id;
  if (!subscribers.includes(chatId)) {
    subscribers.push(chatId);
    saveData();
    bot.sendMessage(chatId, '✅ شما مشترک دریافت پیغام‌های کولر شدید.');
  } else {
    bot.sendMessage(chatId, '⚠️ شما قبلاً مشترک شده‌اید.');
  }
});

bot.onText(/\/unsubscribe/, msg => {
  const chatId = msg.chat.id;
  const idx = subscribers.indexOf(chatId);
  if (idx !== -1) {
    subscribers.splice(idx, 1);
    saveData();
    bot.sendMessage(chatId, '🛑 اشتراک شما لغو شد.');
  } else {
    bot.sendMessage(chatId, '⚠️ شما در لیست مشترکین نیستید.');
  }
});

bot.onText(/\/menu/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const meal = MENU[key] || 'منو ثبت نشده';
  const text = `📅 منوی فردا (${display}): *${meal}*`;
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[
      { text: 'رزرو', callback_data: 'do_reserve' },
      { text: 'لغو رزرو', callback_data: 'do_cancel' }
    ]] }
  });
});

bot.onText(/\/myreserve/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const list = listReservations();
  const exists = list.some(u => u.id === chatId);
  const meal = MENU[key] || '-----';
  const text = exists
    ? `✅ شما برای فردا (${display}) *${meal}* رزرو کرده‌اید.`
    : `⚠️ شما برای فردا (${display}) رزروی ندارید.`;
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/reservations/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const list = listReservations();
  let text = `📋 لیست رزروهای فردا (${display}):\n`;
  if (!list.length) text += 'هیچ رزروی ثبت نشده.';
  else list.forEach((u, i) => { text += `${i+1}. ${u.name}\n`; });
  bot.sendMessage(chatId, text);
});

bot.onText(/\/reserved/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const meal = MENU[key] || 'منو ثبت نشده';
  const list = listReservations();
  let text = `📊 رزرو شده‌ها برای فردا (${display}) — ${meal}:\n`;
  if (!list.length) text += 'هیچ کس رزرو نکرده.';
  else list.forEach((u, i) => { text += `${i+1}. ${u.name}\n`; });
  bot.sendMessage(chatId, text);
});

bot.on('callback_query', query => {
  const chatId = query.message.chat.id;
  const name = query.from.first_name || query.from.username;
  if (query.data === 'do_reserve') {
    const res = reserveMeal(chatId, name);
    const msg = res === true ? '✅ رزرو فردا ثبت شد.' :
                res === 'exists' ? '⚠️ قبلاً رزرو کرده‌اید.' :
                '❌ منو برای فردا موجود نیست.';
    bot.answerCallbackQuery(query.id, { text: msg });
  }
  if (query.data === 'do_cancel') {
    const ok = cancelReservation(chatId);
    const msg = ok ? '🛑 رزرو فردا لغو شد.' : '⚠️ رزوی برای فردا ندارید.';
    bot.answerCallbackQuery(query.id, { text: msg });
  }
});

function sendOn() { if (isCoolingTime()) broadcast(`🔵 لطفا کولر را روشن کنید.\n\n${getFormattedDateTime()}`); }
function sendOff(){ if (isCoolingTime()) broadcast(`⚪️ لطفا کولر را خاموش کنید.\n\n${getFormattedDateTime()}`); }
cron.schedule('0 10-18 * * *',  sendOn); 
cron.schedule('15 10-18 * * *', sendOff);  
cron.schedule('30 10-18 * * *', sendOn); 
cron.schedule('45 10-18 * * *', sendOff); 

console.log('✅ بات مدیریت کولر و رزرو غذا به‌روز شد.');