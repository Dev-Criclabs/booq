# Questions for the writers

Left over from the TEXT-03 pass (sample values to variables). No wording was changed. Each group lists the keys and what they say now. Please answer per group; answers become variables or a note in the locale files.

Variables are written `{name}`. The full list is in `locales/README.md`.

## 1. Is it a field label or a sample name?

If it is a label, we keep it as it is. If it is a sample name on a card, we change it to a variable (`{coachName}`, `{playerName}`, `{studentName}`).

| Key | English | Thai |
|---|---|---|
| P-0066 | Coach name | ชื่อโค้ช |
| A-0031 | Player name | ชื่อผู้เล่น |
| A-0187 | Coach name | ชื่อโค้ช |
| K-0008 | Student name | ชื่อนักเรียน |
| K-0029 | Player name | ชื่อผู้เล่น |
| L-0025 | Coach name | ชื่อโค้ช |

## 2. Is the shop item name copy or catalogue data?

"Set of 3 balls" looks like an item name from the club's shop list. If the name comes from the club's data, these keys are not needed. If it is copy, the 3 becomes `{count}`.

| Key | English | Thai |
|---|---|---|
| P-0072 | Balls (Set of 3 balls) × 1 | ลูกเทนนิส × 1 |
| P-0145 | Add racket, balls (set of 3), towel or water | เพิ่มไม้เทนนิส ลูกเทนนิส (ชุด 3 ลูก) ผ้าขนหนู หรือน้ำดื่ม |
| A-0048 | Balls (Set of 3 balls) | ลูกเทนนิส (ชุด 3 ลูก) |

## 3. Is the 60 minute backup hold fixed or a club setting?

The PRD says backup mode holds a slot for 60 minutes. If it is a setting it becomes `{backupHoldMinutes}`.

| Key | English | Thai |
|---|---|---|
| P-0439 | The club is checking your slip by hand. Your slot is held for up to 60 minutes and the result comes in LINE. | สโมสรกำลังตรวจสลิปด้วยตนเอง ล็อกเวลาไว้ให้สูงสุด 60 นาที ผลจะแจ้งใน LINE |
| A-0459 | Automatic checking stopped at {time}. Slots are held for up to 60 minutes. This page leaves the menu as soon as checking is back on. | ระบบตรวจอัตโนมัติหยุดเมื่อ {time} ล็อกช่วงเวลาไว้ได้สูงสุด 60 นาที หน้านี้จะหายจากเมนูทันทีที่ระบบกลับมาทำงาน |
| A-0461 | {count} waiting · oldest has {minutesLeft} of 60 minutes left | รอ {count} รายการ · รายการแรกสุดเหลือ {minutesLeft} จาก 60 นาที |

## 4. The short club name

"Hunter" is used on its own. Can we add a second variable `{clubShortName}` next to `{clubName}`?

| Key | English | Thai |
|---|---|---|
| P-0397 | Welcome to Hunter | ยินดีต้อนรับสู่ Hunter |
| A-0541 | Hunter uses one price for now | ตอนนี้ Hunter ใช้ราคาเดียว |
| X-0235 | Hunter's setup. Used by {count} clubs. Changes only affect new clubs. | (English only) |

## 5. Ordinals

The number needs a different format in each language (1st or คิวที่ 1). Can we use `{position}` with "1st" in English and "1" in Thai? "7th hour" is the rest rule limit plus 1.

| Key | English | Thai |
|---|---|---|
| P-0354 | 1st in line | คิวที่ 1 |
| P-0357 | 2nd in line | คิวที่ 2 |
| K-0069 | Rest rule. Booking never gives you a 7th hour in a row, even inside these hours. | กฎการพัก ระบบจองจะไม่ให้คุณสอนชั่วโมงที่ 7 ติดต่อกัน แม้อยู่ในช่วงเวลานี้ |
| A-0346 | Rest rule. Booking never offers a coach's 7th hour in a row. | กฎการพัก ระบบจองจะไม่เสนอชั่วโมงที่ 7 ติดต่อกันของโค้ช |

## 6. Dates in upper case

English is upper case (MON 11 JAN), Thai is not. Can we use `{date}` and set the case with styling?

| Key | English | Thai |
|---|---|---|
| K-0042 | MON 11 JAN | จ. 11 ม.ค. |
| K-0047 | TUE 12 JAN | อ. 12 ม.ค. |
| K-0050 | WED 13 JAN | พ. 13 ม.ค. |
| K-0053 | THU 14 JAN | พฤ. 14 ม.ค. |

## 7. A number in one language only

The digit is in the Thai text but the English uses a word or has none. Please align the two.

| Key | English | Thai |
|---|---|---|
| P-0011 | Two details to finish your booking | กรอกอีก 2 ข้อมูลเพื่อจองให้เสร็จ |
| P-0076 | Court hour | ค่าคอร์ต 1 ชั่วโมง |
| A-0306 | Court hour | ค่าคอร์ต 1 ชั่วโมง |
| P-0279 | Book any open hour on either court. Checkout uses your bundle hours first. | จองชั่วโมงว่างได้ทั้ง 2 คอร์ต ตอนชำระเงินจะหักจากแพ็กเกจชั่วโมงก่อน |
| P-0401 | Two indoor courts, {courtPrice} an hour, {openTime} to {closeTime}. | คอร์ตในร่ม 2 คอร์ต ชั่วโมงละ {courtPrice} เปิด {openTime} ถึง {closeTime} |

## 8. Numbers that are not in the PRD

Are these fixed rules or club settings? `[From]`/`[To]` and `[X] h before`: what do they stand for?

| Key | English | Thai |
|---|---|---|
| A-0073 | No visit in 30 days | ไม่มาใช้บริการ 30 วัน |
| A-0279 | Applied once a year to one package and one solo class. LINE message on the 1st of the month. | ใช้ได้ปีละครั้งกับ 1 แพ็กเกจและ 1 คลาสเดี่ยว ส่งข้อความ LINE ทุกวันที่ 1 ของเดือน |
| A-0540 | {from} to {to} | {from} ถึง {to} |
| A-0348 | {hours} h before | {hours} ชม. ก่อน |

## 9. The club's registered details

Should the tax ID and "Head office" become club settings (`{taxId}`, `{branch}`)?

| Key | English | Thai |
|---|---|---|
| A-0357 | 0135569018041 · Head office | 0135569018041 · สำนักงานใหญ่ |
| L-0043 | Tax ID 0135569018041 · Head office | เลขประจำตัวผู้เสียภาษี 0135569018041 · สำนักงานใหญ่ |

## 10. Smaller items

Class template schedule summaries (are they built from data?), "Friend 1 / 2" (sample or placeholder?), the three rich menu labels (the image has six tiles), and `[Yes or no]`.

| Key | English | Thai |
|---|---|---|
| A-0217 | Tue 19:00, Sat 17:00 | อ. 19:00, ส. 17:00 |
| A-0221 | Thu 20:00 | พฤ. 20:00 |
| A-0223 | Sat, Sun 09:00 | ส., อา. 09:00 |
| P-0245 | Friend 1 | เพื่อน 1 |
| P-0247 | Friend 2 | เพื่อน 2 |
| A-0508 | Rich menu label 1 | ชื่อปุ่ม Rich menu 1 |
| A-0510 | Rich menu label 2 | ชื่อปุ่ม Rich menu 2 |
| A-0512 | Rich menu label 3 | ชื่อปุ่ม Rich menu 3 |
| X-0089 | [Yes or no] | (English only) |
