# Circle Grid Logo Builder

Izgara + daire + çapraz çizgilerin kurduğu ağın **kapalı gözlerini** boyayarak
logo üreten vektör tasarım aracı. Illustrator'daki "circle logo design using
grid" yönteminin tarayıcıdaki karşılığı; bölge doldurma mantığı Illustrator'ın
**Live Paint / Pathfinder → Divide** davranışıyla aynıdır.

İki mod vardır:

| Mod | Ne yapar | Dosya |
|-----|----------|-------|
| **Grid Draw** (varsayılan) | Tek ekran. Kılavuz ağının gözlerini boya, tek hamlede daire doldur, temiz SVG indir. | `src/griddraw/` |
| **Vector Studio** | Tam vektör editör: kalem, boolean (Pathfinder), izometrik küp, monogram, katmanlar… | `src/VectorStudio.tsx`, `src/core/`, `src/components/` |

Üst bardaki **Vector Studio →** / **← Grid Draw** düğmeleriyle geçilir; seçim
hatırlanır.

---

## Çalıştırma

```bash
npm install
npm run dev      # http://localhost:5180/
```

> Port **5180**'e sabitlendi (`strictPort`). 5173 makinedeki başka bir proje
> tarafından kullanılabiliyor.

Diğer komutlar:

```bash
npm test         # node --test tests/*.test.ts  (188 test)
npm run build    # tsc -b && vite build  →  dist/
npm run preview  # üretim derlemesini önizle
```

Gereksinimler: Node 20+ (geliştirme Node 24 ile yapıldı), npm 10+.

---

## Sunucusuz çalıştırma (host gerekmez)

`npm run build` sonrası `dist/` klasörü **tamamen statiktir** ve göreli
(`./assets/...`) yollar kullanır — bu yüzden ikinci bir adım gerekmeden
**doğrudan diskten** açılır:

```
dist/index.html   →  çift tıkla (Chrome/Edge) → uygulama tarayıcıda açılır
```

Doğrulandı: `file://` üzerinden açıldığında React uygulaması çalışır, çizim
ve bölge motoru normal işler, `localStorage` çalışır (tasarım sekmede kalır).
Sunucu/kurulum/ağ erişimi gerekmez; klasörü zip’leyip başka makineye de
kopyalayabilirsiniz.

**Önemli:** tarayıcı deposu **adrese (origin) bağlıdır**. `file://` ile açılan
kopya, `http://localhost:5180`'deki kayıtlı tasarımı görmez. Bu yüzden taşımak
için **ÇIKTI → `⭳ Tasarımı indir (JSON)`** ile dosyayı alıp yeni yerde
**`⭱ Tasarım yükle (JSON)`** ile açın (ızgara + kılavuzlar + dolgular + stil
tek dosyada; yükleme tek adımda `Ctrl+Z` ile geri alınır).

### Masaüstü `.exe` yapmak

Uygulama statik + göreli yollarla çalıştığı için üç yol var:

| Yol | Ne yapar | Gereksinim | Boyut |
|-----|----------|-----------|-------|
| **Elektron** | Gerçek `.exe` (kurulum + portable) | `npm i -D electron electron-builder` | ~150 MB |
| **Tauri** | Küçük `.exe`, sistem WebView2 kullanır | Rust + WebView2 | ~5–10 MB |
| **Launcher** | `.bat` yerel statik sunucu açar + tarayıcı | — (Node var) | ~0 |

Elektron iskeleti (özet): `main.js` içinde `new BrowserWindow()` +
`win.loadFile('dist/index.html')`, `package.json`'a
`"build": { "appId": "...", "files": ["dist/**", "main.js"] }` ve
`"dist": "electron-builder --win portable"`. Tauri’de `tauri.conf.json`
`build.frontendDist = "../dist"` ve `devUrl` boş bırakılır.
Zorunlu ön koşul yok: her iki yol da `dist/` klasörünü olduğu gibi kullanır.

---

## Grid Draw nasıl çalışır

1. **Izgara.** Tek bir bölme sayısı vardır ve bu sayı **düşey ile yatayda
   EŞİTTİR**; artboard karedir, dolayısıyla hücreler kare olur. Bu şart:
   köşeden köşeye çaprazların kafes noktalarından geçip **her kareyi tam
   ikiye** bölmesi için gereklidir. Aksi halde çapraz kareleri rastgele
   açılarla keser.
2. **Kılavuzlar opsiyoneldir ve kullanıcı çizer.** Başlangıçta yalnızca
   ızgara vardır (varsayılan **24×24** → hücre 60×60). `◯ Daire` / `╱ Çizgi`
   aracıyla tuvalde sürükleyerek **istediğiniz boyutta** çizersiniz;
   kenetlenme varsayılan olarak **kapalıdır** (`Ctrl` tersine çevirir).
   Çizilmiş bir kılavuzu `✥ Taşı` ile sürükleyebilir, listeden seçip
   sayısal olarak düzenleyebilir (konum, yarıçap, uzunluk) veya ok
   tuşlarıyla ince ayar yapabilirsiniz.
3. **Bölge tespiti.** Izgara + kılavuzlar raster "duvar" olarak çizilir;
   duvar olmayan örnekler 4-komşuluk ile bağlantılı bileşenlere ayrılır.
   Her bileşen bir **gözdür** (bölgedir).
4. **Sınır çıkarma.** İki komşu örnek farklı etiketliyse oluşan "çatlak"lar,
   ait oldukları bölge için **yönlü** kenara çevrilir. Bölge hep aynı tarafta
   kaldığı için dış hat ve delikler kendiliğinden doğru yönde çıkar ve halkalar
   düğüm noktalarından zincirlenir.
5. **Boyama.** Üstteki `✚ Doldur` aracıyla gözün üstüne tıkla ya da sürükle;
   `⊖ Boşalt` aracı aynı şekilde siler. Sürükleme sırasında **fare olayları
   arasında kalan kareler atlanmaz**: son nokta ile yeni nokta arası
   adımlanır (fırça izi). Ayar değişince dolgular yeni plana **yeniden
   eşlenir**, kaybolmaz.
6. **Alan seçimi.** `Shift` + sürükle: dikdörtgen alanın içindeki bütün gözler
   tek hamlede boyanır/silinir (büyük şekiller için).
7. **Tek hamlede doldurma.** Listeden bir kılavuz seçilince:
   `⬤ İçini doldur` (disk), `⬡ Dışını doldur`, **`◍ Aradaki halkayı doldur`
   (iki daire arası halka/şerit)** ya da bir çizginin bir yanı. Halkanın iç
   sınırı seçili daireden küçük **en büyük** dairedir; çıktı tek path + iki alt
   yol (dış çember + iç delik) olur — kalın yay/çember logoları böyle çıkar.
8. **Kesme (daraltma).** Illustrator'daki Pathfinder → Intersect karşılığı:
   `∩ İçine daralt` / `∩ Dışına daralt` (daire), `∩◀ / ∩▶ Yanına daralt` (çizgi)
   mevcut dolguyu seçili kılavuzla kesiştirir. Örnek: `◍ halkayı doldur` →
   çaprazı seç → `∩◀ Yanına daralt` = **yay** (uçları tam çaprazda kesilir,
   halkanın deliği kesikten dolayı açılır). Üst üste uygulanabilir, `Ctrl+Z`
   ile geri alınır.
9. **Aynalama.** Yatay / dikey / 4 yön açıkken boyanan gözün aynadaki
   karşılıkları da kendiliğinden boyanır.
10. **Birleştirme.** Komşu dolu gözler tek silüete indirilir; paylaşılan
    kenarlar tamamen kaybolur (Illustrator'daki Pathfinder → Unite).
11. **Çıktı.** Izgara ve kılavuzlar çıktıya **girmez**; yalnızca dolu gözler
    kalır.

Halka örneği (ölçülen): dış `r 340` + iç `r 200` → `◍ Aradaki halkayı doldur`
= 96 göz, çıktı **1 path / 2 alt yol** (dış çember + delik). Aynı halkayı 45°
çaprazla `∩◀ Yanına daralt` → 46 göz, çıktı **1 path / 1 alt yol** (kesilen
yay).

### Izgara sayısı neyi etkiler?
Bölge sınırı **her zaman** daireye/çizgiye tam oturur — bu, ızgara sayısından
bağımsızdır ve analitik kesişimle hesaplanır. Izgara sayısı yalnızca şeklin
kaç parçaya bölündüğünü belirler:

- **Kaba ızgara** (ör. 8): çember birkaç büyük parçaya ayrılır, boyaması kolay.
- **Sık ızgara** (ör. 24–36): çember çok sayıda küçük parçaya ayrılır ve halka,
  yay uçları daha ince çözünürlükte kesilir; ama fırçayla süpürürken fare
  olayları arasında kalan kareler atlanabiliyordu. Bu yüzden sık ızgarada
  boyama "tutuk" hissettiriyordu — artık fırça izi adımlandığı için ızgara
  sayısı boyama güvenilirliğini etkilemiyor.

Görünüm için aşağıdaki "Görünüm: yakınlaştırma ve gezdirme" bölümüne bakın.

### Hazır gridler (başlangıç şablonları)

Sol paneldeki **HAZIR GRIDLER**, ızgara + kılavuz takımını tek tıkla kurar.
Dolgu **koymaz**: tuval boş açılır, aynı sistemin üzerinde kendi logonuzu
çizersiniz. Şablon uygulamak geri alınabilir bir adımdır (`Ctrl+Z`).

| Şablon | Kurduğu sistem |
|--------|----------------|
| ◉ **Sekiz daire** | 14×14 ızgara + ortak merkezli **4+4 daire** (logonun konstrüksiyonu) |
| ◯ Üç eş merkezli daire | 24×24 + klasik oranlı eş merkezli daireler |
| ╳ Köşe çaprazları | 24×24 + köşeden köşeye X |
| ＋ Merkez artı | 24×24 + merkezden geçen dikey/yatay |

**"Sekiz daire"** logonun çözülen sistemidir: merkezler artboard merkezinden
**(±2, 0) hücre**, yarıçaplar **2 / 3 / 4 / 5 hücre**. Şeklin bütün sınırları
ızgara çizgisi ya da bu dairelerin yayı olur — tepe r=4 dairelerinin kesişimi
(−3,46 hücre), kase dibi r=3 dairelerinin altı (+3), kanat uçları r=3
dairelerinin uçları (±5). Bu şablon **392 göz** üretir ve
`tests/griddraw-output.test.ts` içinde denetlenir.

Şablonun uygulanması, planı boşuna yeniden kurmaz: geri alma kararı
**geometri imzasına** bakar (kılavuz kimlikleri değil, yalnızca şekil). İmza
aynıysa plan geçerli kalır ve dolgular doğrudan geri konur.

Kısayollar: `F` doldur · `E` boşalt · `M` taşı · `5` serbest boyut · `H` gezdir · `Shift`+sürükle
= alan seçimi · `Ctrl+Z` geri al · `Ctrl+Shift+Z` ileri al ·
`+` / `−` / `0` yakınlaştırma · `boşluk`+sürükle = sahneyi kaydır ·
`Esc` çizim/taşıma/gezdirme modundan çık · ok tuşları seçili kılavuzu kaydırır
(`Shift` = 10 birim).

**Taşıma:** `✥ Taşı` (`M`) aracıyla dairenin çemberine ya da çizginin üzerine
basıp sürükleyin; imleç kılavuzun üstüne geldiğinde tutma imlecine döner.
Yakalama alanı ekran ölçeğine bağlıdır (~14 px), yani yakınlaştırma ne olursa
olsun aynı hissi verir. Sürükleme sırasında yalnızca **önizleme** kayar; plan
bırakınca bir kez yeniden kurulur (60 fps'te donmaz). Taşıma modundayken de
boyama çalışır: kılavuzun üstünde taşıma, dışında boyama devreye girer —
kullanıcı modda takılı kalmaz.

**Serbest boyut — dört kenar bağımsız (elips):** `⤢ Serbest boyut` (kısayol
`5`) aracı açıkken seçili dairenin **dört tutamağı** çıkar ve her tutamak
**yalnız kendi kenarını** taşır; **karşı kenar yerinde kalır** (oranlı değil).
Sağ tutamağı dışa çekmek genişliği artırır, yükseklik değişmez — daire
**elips** olur. Geometri `sx` / `sy` (eksen ölçekleri, varsayılan 1) ile
saklanır: ölçek 1'e dönerse alan **tamamen silinir**, dolayısıyla eski
kayıtlar/JSON aynen kalır. Kenar, karşı kenardan en az `MIN_CIRCLE_SIDE = 4`
birim uzakta tutulur (asla yok olmaz). Ölçülen örnek: `r 389`, merkez
`cx 634.96` → sağ tutamak `+90` → `sx 1.116`, sol kenar `245.96` **sabit**,
yükseklik `778` **sabit**; üst tutamak `−60` → `sy 1.077`, alt kenar sabit.
Araç açıkken de boyama çalışır; bırakınca plan bir kez yeniden kurulur ve
`Ctrl+Z` ile geri alınır. `tests/griddraw-output.test.ts` bunu
doğrular (yalnız sürüklenen kenar hareket eder, ölçek 1'de silinir, elips
planı daire planından farklı göz sayısı üretir, eski hâle dönüş bölgeleri
bit bit korur).

**Elips kesişimleri de analitiktir.** İki elipsin (ya da daire × elips)
kesişimi kuartik çözüm gerektirmez: bir elips eksen bazlı ölçeklemeyle
**birim çembere** indirgenir, diğeri aynı uzayda elips kalır; birim çemberin
o elips denklemi `f(θ)` taranıp işaret değiştiren aralıklar ikiye bölünerek
~1e-12 radyana kadar daraltılır. Böylece iki elipsin kesiştiği **lens**
bölgesinin köşeleri raster yaklaşıklığıyla değil tam noktada oturur.
Ölçülen: `1040×520` + `520×1040` elipsler → lens köşesi `(952.55, 952.55)`;
analitik değer `232.589` → sapma **0.04 birim** (raster yolunda ~1–2 birim).

**Sayısal ince ayar:** listeden daireyi seçince sağdaki panelde `X`, `Y`,
`Yarıçap` yanında **`Genişlik`** ve **`Yükseklik`** alanları da vardır: bu iki
alan eksenleri **bağımsız** yazar (yalnız ilgili eksenin ölçeği değişir, merkez
sabit kalır, karşı kenarlar simetrik oynar). `Yarıçap` ise **her iki ekseni
birlikte** ölçekler. Elips hâlindeyken `◯ Daireye döndür` düğmesi iki ekseni
eşitleyip şekli yeniden tam daire yapar. Ölçülen: `Genişlik = 1000` yazınca
`sx 1.285347` (= 1000/778), `r 389` sabit, etiket `◯ 1000×778` → düğme ile
geri `◯ r 389`.

**Tutamaklar (boyutla oynama):** listeden bir kılavuz seçince tuvalde tutamak
çıkar — dairede **yarıçap** (sağdaki kare), çizgide **iki uç**. Tutamağı
sürüklerken yalnızca önizleme güncellenir (plan yeniden kurulmaz, donma
olmaz); bırakınca tek seferde uygulanır. Halkayı kalınlaştırmak için **iç
daireyi seçip tutamağı içe/dıza çekmek yeterlidir: son toplu doldurma (halka)
kendiliğinden tazelenir.** Ölçülen örnek: halka `r 200–340` = 96 göz →
tutamağı `r 110`'a çek → "Halka tazelendi (r 110–340): 116 göz" (delik korunur)
→ `r 270`'e çek → 68 göz. `Shift`+tutamağa basıp ızgaraya kenetlemeyi açıkken
adımlar hücre katı olur.

**Kesme (daraltma):** `∩ İçine daralt` / `∩ Dışına daralt` (daire),
`∩◀ / ∩▶ Yanına daralt` (çizgi) mevcut dolguyu seçili kılavuzla kesiştirir.
Örnek: `◍ halkayı doldur` → çaprazı seç → `∩◀ Yanına daralt` = **yay**
(uçları tam çaprazda kesilir). Üst üste uygulanabilir, `Ctrl+Z` ile geri alınır.

**Geri alma kapsamı:** Her adım hem **ayarları** hem **dolguları** saklar; bu
yüzden boyama, kılavuz çizme, taşıma, silme, sayısal düzenleme, toplu doldurma,
ızgara değişikliği ve ekranı temizleme `Ctrl+Z` ile geri alınır. Arka arkaya
gelen aynı tür düzenlemeler (ok tuşuyla kaydırma, sayı alanına yazma) 800 ms
içinde **tek adım** sayılır; kullanıcı harf harf geri gitmez.

Temizleme: `🧹 Ekranı temizle` dolguları **ve** kılavuzları silip ızgarayı
24×24'e döndürür; sağ paneldeki `⌫ Dolguları temizle` yalnızca dolguları siler.

Tasarım `localStorage`'da saklanır (`logo-builder:griddraw:v2`); sayfayı
yenileseniz de dolgular geri gelir. Eski anahtar ve eski biçim kayıtlar
(cols/rows/circles) okuma sırasında temizlenir/taşınır.

### Görünüm: yakınlaştırma ve gezdirme

- **Yakınlaştırma odağı korur.** `−` / `+` düğmeleri görünen alanın **ortasını**
  sabit tutar; `Ctrl` + fare tekerleği **imlecin altındaki noktayı** sabit tutar.
  Yüzdeye tıklamak `%100`'e döner ve ortalar. Böylece zoom yaparken baktığın
  şey (ör. dairenin merkezi) ekrandan kaymaz.
- **Elle gezdirme:** `✋` düğmesi (kısayol **H**), **boşluk** + sürükle veya
  **orta tuş** + sürükle. Tekerlek = dikey kaydırma, `Shift` + tekerlek = yatay.
  Gezdirme sırasında boyama/çizim devreye girmez.
- **Gezdirme modunda takılı kalmak imkânsız:** bir araç seçmek (`✚ Doldur`,
  `⊖ Boşalt`, `◯ Daire`, `╱ Çizgi`, `✥ Taşı`) ya da `F` / `E` / `M`
  kısayolunu kullanmak gezdirme modunu **otomatik kapatır**. Ayrıca gezdirme
  açıkken tuvalin altındaki satır bunu açıkça söyler: "Gezdirme açık: tıklama
  sahneyi kaydırır — boyamak için ✋ kapatın (H) ya da F/E".
- Ölçülen: `720,720` noktası 100% → 195% arasında ekranda **tam aynı yerde**
  kaldı (591,347); `Ctrl`+tekerlek ile imleç altındaki nokta **0 px** kaydı.

Bunun için bir düzen hatası da düzeltildi: `.gd__artboard` `flex-basis: auto`
idi ve kutu **içerikle büyüyordu**; kâğıt boyutu bu kutunun ölçüsünden
geldiği için yakınlaştırma kendi kendini besleyen bir döngüye girip sahneyi
merkezden kaydırıyordu. `flex: 1 1 0` ile kutu sabitlendi (627×512).

### Çıktı kalitesi garantileri

Hedef "temiz, düzgün, kusursuz" logo çıktısıdır ve bu ölçülebilir kurallara
bağlanmıştır (`tests/griddraw-output.test.ts` her birini denetler):

| Kural | Nasıl sağlanır |
|-------|----------------|
| Paylaşılan kenar ve **boşluk yok** | Birleştirme: bağlantı ve geometri maskeleri ayrı tutulur |
| Her köşe **tam kılavuz üzerinde** | Sınır önce kılavuza oturtulur, sonra sadeleştirilir |
| **Gereksiz nokta yok** | Douglas-Peucker + ortak-doğrusal temizliği (yinelemeli) |
| Kenarlar **tam düz** | Düz kenarın tüm noktaları aynı doğruya oturduğu için tek parçaya iner |
| **Zikzak / çentik yok** | Köpek bacağı temizliği + yakın köşe birleştirme + eksik köşe onarımı |
| Köşeler **yuvarlama hatası taşımaz** | Kesişimler analitik hesaplanır: grid×grid, grid×daire, grid×çizgi, daire×daire, daire×çizgi, çizgi×çizgi, **elips×elips** |
| Yaylar **gerçek yay kalır** | Noktalar tam daire üzerine radyal oturtulur |
| Dolu şeklin içinde **saç teli çatlak olmaz** | Duvar 3 örnek kalınlığında olduğu için birleştirmeden 1–2 örneklik kalıntı kalıyordu; iki yanı aynı parça olan kalıntılar o parçaya katılır (tuvalde ızgara çizgisi örttüğü için görünmez, temiz SVG/PNG çıktısında çatlak olarak çıkıyordu) |

Sınır hattı sırası (tek bir halka için):

```
çatlaklar → zincirleme → kılavuza oturt → Douglas-Peucker
          → köpek bacağı temizliği → yakın köşe birleştirme
          → eksik köşe onarımı → ortak-doğrusal temizliği
```

---

## Klasör yapısı

```
logo_proje/
├── index.html
├── vite.config.ts          # port 5180, strictPort
├── tsconfig.json
├── package.json
├── scripts/
│   ├── add-extensions.ps1  # Node ESM için göreli importlara .ts/.tsx ekler
│   └── fix-encoding.ps1    # Türkçe karakter bozulmasını onarır
├── src/
│   ├── main.tsx
│   ├── App.tsx             # mod kabuğu (Grid Draw ↔ Vector Studio)
│   ├── VectorStudio.tsx    # tam vektör editör ekranı
│   ├── styles.css
│   ├── griddraw/           # ── BASİT MOD ──
│   │   ├── regions.ts      # bölge motoru + birleştirme + aynalama (saf fonksiyonlar)
│   │   ├── gridDrawSvg.ts  # temiz SVG/PNG çıktısı
│   │   ├── gridDrawStorage.ts  # localStorage kayıt/yükleme (+eski anahtar temizliği)
│   │   ├── GridDrawStudio.tsx  # doldur/boşalt, kılavuz çiz-taşı, zoom
│   │   └── griddraw.css
│   ├── core/               # ── VEKTÖR MOTORU ──
│   │   ├── types.ts        # geometri, ayar, araç tipleri
│   │   ├── matrix.ts       # 2B dönüşüm matrisleri
│   │   ├── geometry.ts     # düzleştirme, alan, hit-test, DP, yumuşatma, path
│   │   ├── boolean.ts      # unite/subtract/intersect/exclude/divide
│   │   ├── nodes.ts        # anchor düzenleme
│   │   ├── snap.ts         # eksen-bağımsız snap + kılavuzlar
│   │   ├── factory.ts      # obje üretimi
│   │   ├── pen.ts          # kalem eğrileri
│   │   ├── isometric.ts    # izometrik izdüşüm, küp, extrude, yüz projeksiyonu
│   │   ├── monogram.ts     # A–Z harf kütüphanesi
│   │   ├── operations.ts   # Pathfinder, shape builder, knife, clip
│   │   ├── export.ts       # SVG/PNG
│   │   ├── persistence.ts  # localStorage, autosave, dosya indirme
│   │   ├── svgImport.ts    # SVG içe aktarma
│   │   ├── demoProject.ts  # demo SAD monogramı
│   │   └── generators/dLogo.ts  # parametrik GRID D logosu
│   ├── store/editorStore.ts     # useSyncExternalStore + geri al/ileri al
│   └── components/              # arayüz: tuvaller, paneller, araç çubukları
└── tests/
    ├── core.test.ts        # motor: matris, boolean, geometri, snap, export…
    ├── regression.test.ts  # boolean delik regresyonları
    ├── generators.test.ts  # D logosu üreteci + eksen-bağımsız snap
    ├── isometric.test.ts   # izdüşüm, latis, küp, extrude, yüz projeksiyonu
    ├── griddraw.test.ts    # bölge motoru, snapping, taşıma isabeti, daire/yan doldurma, temiz SVG çıktısı
    └── griddraw-output.test.ts # ÇIKTI KALİTESİ: birleştirme, aynalama, kayıt, kusursuz geometri kuralları
```

---

## Geliştirme notları

- **Göreli importlarda açık uzantı şart** (`.ts` / `.tsx`): testler ve tarayıcı
  Node ESM kurallarıyla çalışır. Yeni dosya ekledikten sonra
  `powershell -File scripts/add-extensions.ps1` çalıştırın.
- **State güncelleyicileri saf olmalı.** Kayıtlı dolguları yükleyen `setFills`
  güncelleyicisi bir ara `pendingFills.current = null` yazıyordu; React
  güncelleyiciyi iki kez çağırınca (StrictMode/eşzamanlı mod) ikinci çağrı boş
  küme döndürüyor ve **yenileme sonrası tasarım kayboluyordu**. Ref okuma/yazma
  güncelleyicinin dışına taşındı. `useState` güncelleyicisi içinde yan etki
  yapmayın.
- Panel bir flex kolon olduğu için çocukları varsayılan olarak kısalır
  (`flex-shrink: 1`) ve içerik uzayınca **kılavuz listesi 0 yüksekliğe çöküyordu**
  (görünmez + tıklanamaz). `.gd__panel > * { flex-shrink: 0 }` ile çözüldü;
  panelin kendisi kaydırır.
- **Türkçe karakterli dosyaları** PowerShell `Get-Content`/`Set-Content` ile
  okumayın/yazmayın (UTF-8 mojibake). `[System.IO.File]::ReadAllText/WriteAllText`
  kullanın veya `scripts/fix-encoding.ps1` ile onarın.
- `tsconfig.json` yalnızca `src` klasörünü kapsar; testler `node --test` ile
  doğrudan çalışır.
- Bölge motoru katsayıları `src/griddraw/regions.ts` başında açıklanmıştır
  (`CURVE_HALF`, `MIN_REGION_AREA`, `SIMPLIFY_TOL`, `SNAP_TOL`). Bu sabitler
  birbirine bağlıdır: snapping toleransı duvar kalınlığını karşılamalı, ama
  komşu kılavuza yanlış oturmayacak kadar küçük olmalıdır.
- Birleştirmede **iki ayrı genişletme** kullanılır ve bu ayrım kritiktir:
  `MERGE_CLOSE` (bağlantı) komşu gözleri tek parça sayar, `MERGE_SHAPE`
  (geometri) sınırı kılavuzun üstüne oturtur. Geometriyi fazla genişletmek
  sınırı kılavuzun öbür tarafına taşırır; snapping o noktaları geri çekince
  sıraları ters döner ve çıktıda zikzak oluşur.
- Köşe onarımı **iki adımlıdır**: yakın iki nokta tek gerçek köşede
  *birleştirilir*, uzak iki nokta arasına eksik köşe *eklenir*. Yalnızca
  ekleme yapmak çıktıda fazladan nokta bırakır.
- Ayarlar `{ grid, size, guides }` biçimindedir; `grid` tek sayıdır (düşey =
  yatay), `size` kare artboard kenarıdır, `guides` kullanıcının çizdiği
  daire/çizgi listesidir. `normalizeSettings` eski `cols/rows/circles`
  kayıtlarını bu biçime taşır.
