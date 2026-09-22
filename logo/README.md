# Görseldeki logo — yeniden üretim

Referans: uygulamada elle çizilmiş hâli (`images (1).jpg`). Bu klasör, o çizimin
ölçümle çözülen **konstrüksiyonunu** ve uygulamaya geri yüklenebilir **tarifini**
tutar.

## Konstrüksiyon (referans görselden ölçülerek çözüldü)

| Öğe | Değer |
| --- | --- |
| Izgara | **14 × 14** (hücre 102,857 birim, artboard 1440) |
| Daire sayısı | **8** — 4'ü sağda, 4'ü solda, hepsi **ortak merkezli** |
| Daire merkezi | artboard merkezinden **(±2, 0) hücre** → (514,29 , 720) ve (925,71 , 720) |
| Yarıçaplar | **2, 3, 4, 5 hücre** → 205,71 · 308,57 · 411,43 · 514,29 |
| Çapraz çizgi | **yok** — şeklin her sınırı ızgara çizgisi ya da bu dairelerin yayı |
| Dolgu | 392 bölgenin **70**'i |

Ölçümün doğruladığı kilit noktalar:

- **Tepe** (V çentiğin ucu) = r=4 dairelerinin kesişimi → merkezden **−3,46 hücre**
- **Kase dibi** = r=3 dairelerinin altı → **+3 hücre**
- **Kanat uçları** = r=3 dairelerinin sağ/sol ucu → **±5 hücre**
- Omuz (üst çubuk) üst kenarı ızgara çizgisi (**−1 hücre**), alt kenarı **0**
- İçteki iki beyaz yaprak, r=2/r=3 ve r=4 yaylarının arasında kalır

## Dosyalar

- `circle-logo.svg` — temiz vektör çıktı: tek path, 7 halka (dış hat + delikler)
- `circle-logo.json` — tarif: ayarlar (ızgara + 8 daire) ve 70 dolgu kimliği

## Uygulamaya geri yükleme

Uygulama açıkken tarayıcı konsoluna:

```js
localStorage.setItem(
  'logo-builder:griddraw:v2',
  await (await fetch('/logo/circle-logo.json')).text(),
);
location.reload();
```

Sayfa yenilendiğinde "Kayıtlı tasarım yüklendi (70 bölge)" görünür; tasarım
uygulamanın kendi kaydı olduğu için çizmeye, kılavuz taşımaya, renk değiştirmeye
ve `SVG indir` / `PNG indir` ile dışa aktarmaya hazırdır.
