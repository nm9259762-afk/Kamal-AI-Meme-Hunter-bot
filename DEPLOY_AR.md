# KAMAL AI MEME HUNTER 24/7 — V2

## ما تم إصلاحه
- إصلاح سبب `API ERROR` عند النشر: الواجهة تستخدم `/api/*` من نفس Worker.
- إضافة تشخيص واضح عندما يتم فتح `index.html` كملف محلي (`file://` / `content://`).
- إصلاح خطأ محرك الاكتشاف: النسخة السابقة كانت تستدعي `this.discover()` بدون وجود الدالة.
- إضافة اكتشاف العملات من DexScreener Token Profiles + Token Boosts ثم جلب الـpairs وتحليلها.
- استمرار مراقبة الصفقات المفتوحة وتثبيت الـpair نفسه.
- إضافة `package.json` وأوامر تشغيل/نشر مباشرة عبر Wrangler.

## مهم
فتح `public/index.html` مباشرة من الهاتف **لن يشغّل المحرك**. يجب نشر المشروع كـCloudflare Worker ثم فتح رابط الـWorker.

## النشر عبر الكمبيوتر/Termux
```bash
npm install
npx wrangler login
npm run deploy
```

بعد النشر افتح رابط الـWorker الذي يظهره Wrangler، وليس ملف `index.html`.

## الوضع الافتراضي
- PAPER = افتراضي.
- LIVE لا يعمل إلا بعد إعداد Execution Bridge على الخادم.
- لا تضع Seed Phrase أو Private Key داخل المشروع أو المتصفح.

## فحص سريع بعد النشر
افتح:
- `/` للوحة.
- `/api/state` للتأكد أن API تعمل.

يجب أن يعيد `/api/state` JSON يحتوي على `ok:true`.

## ملاحظة عن 24/7
المحرك يستخدم Durable Object + alarm. عند تشغيل START 24/7 يتم جدولة tick متكرر، والـcron يعيد تنشيط المحرك دوريًا.
