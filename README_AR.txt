KAMAL AI MEME HUNTER • 24/7 ENGINE

هذه النسخة تفصل الواجهة عن المحرك:
- المتصفح = مراقبة الصفقات المفتوحة فقط.
- Durable Object = محرك مستمر 24/7.
- DEX Screener = بيانات السوق واكتشاف المرشحين.
- Execution Bridge = التنفيذ الحقيقي في LIVE.
- لا يوجد Seed Phrase أو Private Key داخل الواجهة.

1) المتطلبات
- حساب Cloudflare.
- Node.js 16.17+.
- Wrangler.

2) تثبيت Wrangler
npm i -D wrangler

3) تسجيل الدخول
npx wrangler login

4) تشغيل محلي
npx wrangler dev

5) نشر
npx wrangler deploy

6) LIVE
أضف Secrets إلى Worker:
npx wrangler secret put EXECUTION_BRIDGE_URL
npx wrangler secret put EXECUTION_BRIDGE_TOKEN

Execution Bridge يجب أن يقبل POST JSON ويعيد HTTP 2xx فقط بعد قبول/تنفيذ الأمر.

مهم: Trust Wallet في الواجهة يثبت عنوان المحفظة فقط. لا يعطي الخادم مفتاحًا خاصًا ولا يسمح بالتوقيع الصامت. للتداول غير المراقب يجب أن يكون Execution Bridge مبنيًا بطريقة توقيع آمنة/مفوّضة ومحدودة الصلاحيات.

الحماية:
- PAPER هو الوضع الافتراضي.
- LIVE مقفول إذا لم يوجد Bridge أو Wallet.
- Kill Switch يوقف الأوامر الجديدة.
- Max Open / Daily Loss Cap / Cooldown موجودة على الخادم.
- الأسعار تراقب كل 5 ثوانٍ تقريبًا، والاكتشاف كل 15 ثانية تقريبًا.
- هذا ليس ضمانًا للربح ولا ضمانًا للوصول إلى 1000X.
