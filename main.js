const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input");
const fs = require("fs");
const Jimp = require("jimp");
const QrCode = require("qrcode-reader");
const puppeteer = require("puppeteer");

const apiId = 11818937;
const apiHash = "698f2c6cf5deaf06a53dfcc3b199b0a2";
const stringSession = new StringSession("");
const phone = "0996327837";

async function redeemAngpaoPuppeteer(voucherHash, phone, chatId) {
  try {
    const url = `https://gift.truemoney.com/campaign/vouchers/${voucherHash}/redeem`;
    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.goto(`https://gift.truemoney.com/campaign/?v=${voucherHash}`, { waitUntil: "networkidle2", timeout: 10000 });

    const result = await page.evaluate(async (url, phone, voucherHash) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile: phone, voucher_hash: voucherHash })
      });
      return await res.json();
    }, url, phone, voucherHash);

    await browser.close();

    if (result?.status?.code === "SUCCESS") {
      const amount = result?.data?.my_ticket?.amount_baht;
      console.log(`[${chatId}] รับอั่งเปาสำเร็จ: ${amount} บาท`);
    } else {
      console.log(`[${chatId}] ไม่สำเร็จ: ${result?.status?.message || "Unknown error"}`);
    }
  } catch (e) {
    console.log(`[${chatId}] [PUPPETEER ERROR]`, e.message || e);
  }
}

async function decodeQRFromFile(imgPath) {
  const image = await Jimp.read(imgPath);
  const qr = new QrCode();
  return new Promise((resolve, reject) => {
    qr.callback = (err, value) => {
      if (err || !value) return reject("ถอด QR ไม่สำเร็จ");
      resolve(value.result);
    };
    qr.decode(image.bitmap);
  });
}

(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: async () => await input.text("เบอร์โทร (เช่น +66...): "),
    password: async () => await input.text("2FA password: "),
    phoneCode: async () => await input.text("รหัส OTP: "),
    onError: (err) => console.log(err),
  });
  console.log(">> Logged in! Session string:", client.session.save());

  client.addEventHandler(async (event) => {
    const message = event.message;
    const chatId = message.chatId;

    // 1. ถ้าเป็นข้อความ
    if (message.message) {
      const match = message.message.match(/v=([0-9A-Za-z]{35})/);
      if (match) {
        const voucherHash = match[1];
        console.log(`[${chatId}] พบ v=hash: ${voucherHash}`);
        await redeemAngpaoPuppeteer(voucherHash, phone, chatId);
      }
    }
    // 2. ถ้าแนบไฟล์ภาพ (QR)
    if (message.media) {
      try {
        const buffer = await client.downloadMedia(message.media);
        const filename = `qr_${Date.now()}.jpg`;
        fs.writeFileSync(filename, buffer);
        try {
          const qrText = await decodeQRFromFile(filename);
          const found = qrText.match(/v=([0-9A-Za-z]{35})/);
          if (found) {
            const voucherHash = found[1];
            console.log(`[${chatId}] พบ QR v=hash: ${voucherHash}`);
            await redeemAngpaoPuppeteer(voucherHash, phone, chatId);
          } else {
            console.log(`[${chatId}] QR นี้ไม่มี v=hash`);
          }
        } catch (e) {
          console.log(`[${chatId}] ถอด QR ไม่สำเร็จ`);
        }
        fs.unlinkSync(filename);
      } catch (e) {
        console.log(`[${chatId}] โหลดรูปผิดพลาด`);
      }
    }
  }, new NewMessage({}));
})();
