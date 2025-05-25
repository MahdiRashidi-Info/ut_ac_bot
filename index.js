const fs            = require('fs');
const path          = require('path');
const TelegramBot   = require('node-telegram-bot-api');
const cron          = require('node-cron');
const moment        = require('moment-jalaali');

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

const token = "7972229213:AAFi1xooCGC8L5sOMvi83zXDaS5ZD6aVk_U";
if (!token) {
  console.error('❌ Please set BOT_TOKEN in your environment (.env) file.');
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
  Wednesday: 'کباب تابه‌ای',
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
  const helpText = `👋 سلام دوست خنک‌دوست!

اینجا ربات کولر و غذامون هست:
🍃 هر روز بین ۱۰ تا ۱۹، هر ربع خاموش/روشن کولر  
🍽 منوی خوشمزه‌ی فردا و امکان رزرو  

برای شروع یک دستور انتخاب کن:`;
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

❄️ *بخش کولر* (۱۰ صبح تا ۷ عصر)
• /subscribe — عضویت در هشدارهای کولر  
• /unsubscribe — لغو اشتراک  

🍽 *بخش غذا*  
• /menu — دیدن منوی فردا + دکمه‌های رزرو  
• /myreserve — وضعیت رزرو شما  
• /reservations — لیست اسامی  
• /reserved — آمار رزروها`;
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/subscribe/, msg => {
  const chatId = msg.chat.id;
  if (!subscribers.includes(chatId)) {
    subscribers.push(chatId);
    saveData();
    bot.sendMessage(chatId, '✅ تبریک! حالا عضو گروه کولرهای خنک هستی 🌬️');
  } else {
    bot.sendMessage(chatId, '⚠️ تو همین الانم تو لیست کولرهای خنک هستی 😉');
  }
});

bot.onText(/\/unsubscribe/, msg => {
  const chatId = msg.chat.id;
  const idx = subscribers.indexOf(chatId);
  if (idx !== -1) {
    subscribers.splice(idx, 1);
    saveData();
    bot.sendMessage(chatId, '🛑 اشتراک کولرت خاموش شد! فردا بدون ما لذت ببر 😢');
  } else {
    bot.sendMessage(chatId, '⚠️ تو اصلاً عضو لیست نبودی که بخوای لغو کنی 😉');
  }
});

bot.onText(/\/menu/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const meal = MENU[key] || 'منو تعریف نشده';
  const text = `📅 منوی فردا (${display}): *${meal}*

آماده‌ای برای یک تجربه‌ی لذیذ؟`;
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[
      { text: '🍽 رزرو کن!', callback_data: 'do_reserve' },
      { text: '❌ انصراف از رزرو', callback_data: 'do_cancel' }
    ]] }
  });
});

bot.onText(/\/myreserve/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const list = listReservations();
  const exists = list.some(u => u.id === chatId);
  const meal = MENU[key] || '---';
  const text = exists
    ? `✅ تو برای فردا (${display})، *${meal}* رزرو کردی! جونت…`
    : `⚠️ هنوز برای فردا (${display}) رزروی نداری. عجله کن!`;
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
});

bot.onText(/\/reservations/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const list = listReservations();
  let text = `📋 لیست رزروهای فردا (${display}):\n`;
  if (!list.length) text += '— هیچ‌کس لذتشو از دست نداده هنوز!';
  else list.forEach((u, i) => { text += `${i+1}. ${u.name}\n`; });
  bot.sendMessage(chatId, text);
});

bot.onText(/\/reserved/, msg => {
  const chatId = msg.chat.id;
  const { key, display } = getTargetDay();
  const meal = MENU[key] || 'نامشخص';
  const list = listReservations();
  let text = `📊 آمار رزروها (${display}) — ${meal}:\n`;
  if (!list.length) text += 'هیچ‌کس شانسشو امتحان نکرده!';
  else list.forEach((u, i) => { text += `${i+1}. ${u.name}\n`; });
  bot.sendMessage(chatId, text);
});

bot.on('callback_query', query => {
  const chatId = query.message.chat.id;
  const name = query.from.first_name || query.from.username;
  if (query.data === 'do_reserve') {
    const res = reserveMeal(chatId, name);
    const msg = res === true
      ? '🎉 رزرو فردا با موفقیت انجام شد! نوش جان :)'
      : res === 'exists'
        ? '😉 تو قبلاً رزرو کرده بودی!'
        : '❌ امروز منو نیست که رزرو کنی.';
    bot.answerCallbackQuery(query.id, { text: msg });
  }
  if (query.data === 'do_cancel') {
    const ok = cancelReservation(chatId);
    const msg = ok
      ? '🛑 رزرو فردا لغو شد. شاید دفعه‌ی بعد ;)'
      : '⚠️ رزروی برای لغو کردن نداری!';
    bot.answerCallbackQuery(query.id, { text: msg });
  }
});

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sendOn() {
  if (!isCoolingTime()) return;

  const messages = [
    '❄️ روشنش کن که داریم می‌پزیم! کولر جان بیا به دادمون!',
    '🌬️ وقتشه روشن شی کولر عزیز! نجاتمون بده از این گرما!',
    '🧊 برو کولر رو روشن کن، مغزم داره سرخ میشه!',
    '🔥 دمای هوا: جهنم! راه حل: کولر روشن!',
    '😓 داریم بخار میشیم، کولررررررر روشن لطفاً!',
    '💦 کمک! کولر روشن کن قبل از اینکه بخار شیم!',
    '🌡️ دماسنج گفت "دیگه بسه"! روشنش کن کولر رو!',
    '⚡️ هشدار گرمایی: کولر الآن روشن کن، فردا قصه‌ست!',
    '🌀 بیا با کولر گردباد بسازیم، گرما فانیه!',
    '🌈 چرا رنگ هوا اینقدر قرمزه؟ کولر رو روشن کن تا هوای آبی بشه!',
    '🥵 سیستم دمایی من فشل شده، لطفاً کولر رو راه‌اندازی کن!',
    '📢 اعلام وضعیت اضطراری حرارتی: کولر روشن لطفاً!',
    '🎶 بدون کولر، ترانه‌ زندگی ناقصه! روشنش کن!',
    '🏖️ شبیه ساحل داغ شدیم، یک نسیم از کولر بده!',
    '✨ حس می‌کنم دارم با ساندویچ درست می‌شم، کولر رو فعال کن!',
    '🚀 آماده پرتاب به سرزمین خنکی؟ پس کولر رو روشن کن!',
    '🦄 گرما جادوی سیاره‌مونو از بین برده، کولر بیا جادو کن!',
    '🌍 سفینه گرما داره کره زمین رو می‌سوزونه، کولر رو روشن کن!',
    '🎈 گرما بادکنک ما رو ترکونده، کولر جان بیا پرش کنم!',
    '🕶️ بدون کولر هیچ جذابیتی نیست، لطفاً روشنش کن!'
  ];

  broadcast(getRandom(messages));
}

function sendOff() {
  if (!isCoolingTime()) return;

  const messages = [
    '🛑 خاموشش کن قبل از اینکه برق‌مون قطع شه!',
    '⚠️ کولر رو خاموش کن، داریم به قبض برق نزدیک می‌شیم!',
    '💸 خاموش کن که جریمه نیاد، خنک شدیم دیگه!',
    '🌬️ بسه دیگه، کولر رو استراحت بده یه ذره!',
    '🥶 داریم یخ می‌زنیم! کولر رو خاموش کن!',
    '🚨 فرمان ایست! کولر رو خاموش کن که داریم صرفه‌جویی می‌کنیم!',
    '❌ قطعش کن، خنکی به حد کافی رسید!',
    '🔌 زمان شارژ برق داریم تموم می‌شه، کولر خاموش!',
    '🌟 دمای ستاره‌ای اتاق با کولر کافی شد، خاموشش کن!',
    '📦 بسته خنکی تحویل داده شد، کولر رو ببند!',
    '🎯 هدف دما به دست اومد، کولر off!',
    '🎉 جشن خنکی برگزار شد، کولر استراحت!',
    '⏰ تایمر خنک‌سازی به پایان رسید، خاموشش کن!',
    '🎁 هدیه گرما نبود، کولر رو خاموش کنید لطفاً!',
    '🕵️ از بررسی شرایط جوّی معلوم شد دیگه لازم نیست، خاموش!',
    '📉 دمای خونمون به حد مطلوب رسید، کولر stop!',
    '🏝️ ساحل خنکی ترک شد، کولر now off!',
    '🛌 وقت خواب خنک شده؛ کولر استراحت کنه!',
    '🍃 نسیم طبیعی کافیه، کولر که دیگه بسه!',
    '🔇 لطفاً سکوت کن؛ کولر خاموش شد!'
  ];

  broadcast(getRandom(messages));
}

cron.schedule('0 10-18 * * 6,0,1,2,3',  sendOn); 
cron.schedule('15 10-18 * * 6,0,1,2,3', sendOff);  
cron.schedule('30 10-18 * * 6,0,1,2,3', sendOn); 
cron.schedule('45 10-18 * * 6,0,1,2,3', sendOff); 


console.log('✅ Cooling & Lunch Reservation Bot is up and running!');
