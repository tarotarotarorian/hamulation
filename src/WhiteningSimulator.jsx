import { useState, useRef, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------
   ホワイトニングシミュレーター サンプルアプリ (Phase 0)
   - TOP: 地域のおすすめクリニック(ダミー) + シミュレーター導線
   - シミュレーター: 画像アップロード or インカメラ → 歯の色調補正
   - 方式(オフィス/ホーム/セルフ) × 回数 で白さが変化
   - Before/After スライダー + シェードガイド表示
   ------------------------------------------------------------------ */

const C = {
  bg: "#F6FAF9",
  card: "#FFFFFF",
  ink: "#12312D",
  sub: "#5B7370",
  teal: "#0E8578",
  tealDark: "#0A6157",
  mint: "#DDF0EC",
  amber: "#F5A623",
  amberDark: "#D98F12",
  line: "#E3EDEA",
};

const SHADES = [
  { name: "A4", hex: "#C9A57B" },
  { name: "A3.5", hex: "#D3B189" },
  { name: "A3", hex: "#DCBD97" },
  { name: "A2", hex: "#E5CBA8" },
  { name: "A1", hex: "#EEDBBC" },
  { name: "B2", hex: "#F0E0C4" },
  { name: "B1", hex: "#F5EAD3" },
  { name: "BL", hex: "#FAF3E3" },
];

const METHODS = [
  { id: "office", label: "オフィス", desc: "歯科医院で施術", perSession: 0.30 },
  { id: "home", label: "ホーム", desc: "自宅でマウスピース", perSession: 0.17 },
  { id: "self", label: "セルフ", desc: "サロンで自分で照射", perSession: 0.11 },
];

const CLINICS = [
  { name: "おうみ湖畔デンタルクリニック", area: "大津市・膳所", tag: "オフィス", price: "¥16,500〜", rating: 4.7, note: "駅徒歩3分 / 平日20時まで" },
  { name: "くさつホワイトニングサロン LUMO", area: "草津市・草津駅前", tag: "セルフ", price: "¥4,980〜", rating: 4.5, note: "初回半額 / 当日予約OK" },
  { name: "びわこ中央歯科", area: "大津市・浜大津", tag: "ホーム", price: "¥27,500〜", rating: 4.6, note: "マウスピース即日作成" },
  { name: "南草津スマイル歯科", area: "草津市・南草津", tag: "オフィス", price: "¥19,800〜", rating: 4.4, note: "土日診療 / 駐車場あり" },
];

/* --- 歯っぽいピクセルの判定(簡易ヒューリスティック) --- */
function toothMask(r, g, b) {
  const brightness = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  if (brightness < 95) return 0;
  if (sat > 85) return 0;
  if (b > r + 12) return 0; // 青すぎるものは除外
  if (g > r + 10) return 0; // 緑すぎるものは除外
  // 明るく低彩度なほど強くマスク
  const bw = Math.min(1, (brightness - 95) / 90);
  const sw = 1 - Math.min(1, sat / 85);
  return Math.min(1, bw * 0.6 + sw * 0.6);
}

function applyWhitening(src, dst, intensity, w, h, region) {
  const s = src.data;
  const d = dst.data;
  const cx = region.cx * w;
  const cy = region.cy * h;
  const rx = Math.max(8, region.r * w);
  const ry = Math.max(6, rx * 0.55);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = s[i], g = s[i + 1], b = s[i + 2];
      // 楕円の内側だけ処理(縁はなめらかにフェード)
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const dist = dx * dx + dy * dy;
      let area = 0;
      if (dist < 0.75) area = 1;
      else if (dist < 1.2) area = (1.2 - dist) / 0.45;
      const m = area > 0 ? toothMask(r, g, b) * intensity * area : 0;
      if (m > 0.01) {
        // 白方向へブレンド + 黄ばみ(青チャンネル不足)を補正
        d[i] = r + (255 - r) * m * 0.75;
        d[i + 1] = g + (255 - g) * m * 0.78;
        d[i + 2] = Math.min(255, b + (255 - b) * m * 0.95);
        d[i + 3] = s[i + 3];
      } else {
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = s[i + 3];
      }
    }
  }
}

export default function WhiteningSimulator() {
  const [screen, setScreen] = useState("home"); // home | sim
  const [imgSrc, setImgSrc] = useState(null);
  const [method, setMethod] = useState("office");
  const [sessions, setSessions] = useState(3);
  const [split, setSplit] = useState(0.5);
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState("");
  const [imgStatus, setImgStatus] = useState("");
  const [mouth, setMouth] = useState({ cx: 0.5, cy: 0.62, r: 0.16 }); // 口元エリア(相対座標)
  const [editMode, setEditMode] = useState("area"); // area(エリア調整) | compare(比較)

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(false);

  const m = METHODS.find((x) => x.id === method);
  const intensity = Math.min(0.85, 1 - Math.pow(1 - m.perSession, sessions));
  const startShade = 2; // A3想定
  const shadeIdx = Math.min(SHADES.length - 1, startShade + Math.round(intensity * 7));

  /* --- 描画 --- */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    try {
    const maxW = 640;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const before = ctx.getImageData(0, 0, w, h);
    const after = ctx.createImageData(w, h);
    applyWhitening(before, after, intensity, w, h, mouth);
    // 左=Before / 右=After をスライダー位置で分割
    ctx.putImageData(before, 0, 0);
    const sx = Math.round(w * split);
    if (sx < w) {
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      tmp.getContext("2d").putImageData(after, 0, 0);
      ctx.drawImage(tmp, sx, 0, w - sx, h, sx, 0, w - sx, h);
    }
    // 分割線
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(sx - 1, 0, 2, h);
    // エリア調整モード時は楕円ガイドを表示
    if (editMode === "area") {
      ctx.save();
      ctx.strokeStyle = "#0E8578";
      ctx.lineWidth = Math.max(2, w / 240);
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.ellipse(mouth.cx * w, mouth.cy * h, Math.max(8, mouth.r * w), Math.max(6, mouth.r * w * 0.55), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    } catch (err) {
      setImgStatus("画像の処理中にエラーが発生しました。別の写真でお試しください。");
    }
  }, [intensity, split, mouth, editMode]);

  useEffect(() => { render(); }, [render, imgSrc]);

  /* --- 画像読み込み --- */
  const loadFile = (f) => {
    if (!f) return;
    setImgStatus("読み込み中…");
    const reader = new FileReader();
    reader.onerror = () => setImgStatus("ファイルを読み込めませんでした。別の写真でお試しください。");
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        setImgStatus("");
        stopCamera();
        setEditMode("area");
        setMouth({ cx: 0.5, cy: 0.62, r: 0.16 });
        setImgSrc(reader.result);
      };
      img.onerror = () =>
        setImgStatus("この画像形式を表示できませんでした(iPhoneのHEIC形式の可能性)。スクリーンショットを撮ってその画像を選ぶか、設定→カメラ→フォーマットを「互換性優先」にして撮影し直すと読み込めます。");
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    loadFile(f);
    e.target.value = ""; // 同じファイルの再選択を許可
  };

  /* --- カメラ --- */
  const startCamera = async () => {
    setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }, audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 50);
    } catch (err) {
      setCamError("カメラを起動できませんでした。画像アップロードをご利用ください。");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const tmp = document.createElement("canvas");
    tmp.width = v.videoWidth;
    tmp.height = v.videoHeight;
    const ctx = tmp.getContext("2d");
    // インカメラは左右反転して保存
    ctx.translate(tmp.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    const url = tmp.toDataURL("image/jpeg", 0.92);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setEditMode("area");
      setMouth({ cx: 0.5, cy: 0.62, r: 0.16 });
      setImgSrc(url);
      stopCamera();
    };
    img.src = url;
  };

  useEffect(() => () => stopCamera(), []);

  /* --- キャンバス上のドラッグ操作(モード別) --- */
  const xyFromEvent = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const py = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return {
      x: Math.max(0.02, Math.min(0.98, px / rect.width)),
      y: Math.max(0.02, Math.min(0.98, py / rect.height)),
    };
  };
  const applyPointer = (e) => {
    const p = xyFromEvent(e);
    if (editMode === "area") setMouth((prev) => ({ ...prev, cx: p.x, cy: p.y }));
    else setSplit(p.x);
  };
  const onDown = (e) => { dragRef.current = true; applyPointer(e); };
  const onMove = (e) => { if (dragRef.current) applyPointer(e); };
  const onUp = () => { dragRef.current = false; };

  /* ================= UI ================= */
  const font = { fontFamily: "'Zen Maru Gothic','Hiragino Maru Gothic ProN','Noto Sans JP',sans-serif" };

  return (
    <div style={{ ...font, background: C.bg, minHeight: "100vh", color: C.ink, maxWidth: 480, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&family=Noto+Sans+JP:wght@400;500;700&display=swap');
        button { cursor: pointer; font-family: inherit; }
        button:focus-visible { outline: 3px solid ${C.amber}; outline-offset: 2px; }
      `}</style>

      {/* ---------- ヘッダー ---------- */}
      <header style={{ padding: "16px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: 0.5 }}>
            <span style={{ color: C.teal }}>ハミル</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginLeft: 8 }}>歯の未来をシミュレーション</span>
          </div>
        </div>
        <div style={{ fontSize: 11, background: C.mint, color: C.tealDark, borderRadius: 999, padding: "6px 12px", fontWeight: 700 }}>
          📍 滋賀県 大津市
        </div>
      </header>

      {screen === "home" && (
        <main style={{ padding: "0 16px 40px" }}>
          {/* ---------- シミュレーター導線 ---------- */}
          <button
            onClick={() => setScreen("sim")}
            style={{
              width: "100%", border: "none", textAlign: "left",
              background: `linear-gradient(135deg, ${C.teal}, ${C.tealDark})`,
              borderRadius: 20, padding: "22px 20px", color: "#fff",
              boxShadow: "0 8px 24px rgba(14,133,120,0.28)", marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, marginBottom: 4 }}>無料・登録不要</div>
            <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.3 }}>ホワイトニング<br />シミュレーター</div>
            <div style={{ fontSize: 13, marginTop: 8, opacity: 0.92 }}>あなたの写真で、白くなった歯を今すぐ体験 →</div>
          </button>

          <div
            style={{
              width: "100%", background: C.card, border: `1.5px dashed ${C.line}`,
              borderRadius: 20, padding: "16px 20px", marginBottom: 24,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: C.sub }}>矯正シミュレーター</div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>理想の歯並びをAIで生成</div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, background: "#F0F4F3", color: C.sub, borderRadius: 999, padding: "6px 12px" }}>近日公開</div>
          </div>

          {/* ---------- 地域のおすすめ ---------- */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>近くのおすすめ</h2>
            <span style={{ fontSize: 11, color: C.sub }}>大津・草津エリア</span>
          </div>

          {CLINICS.map((c) => (
            <div key={c.name} style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 10, border: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{c.area}・{c.note}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.tealDark, background: C.mint, borderRadius: 8, padding: "4px 8px", height: "fit-content", whiteSpace: "nowrap" }}>{c.tag}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: C.amberDark, fontWeight: 700 }}>★ {c.rating}</span>
                  <span style={{ marginLeft: 10, fontWeight: 700 }}>{c.price}</span>
                </div>
                <button style={{ background: C.amber, border: "none", color: "#fff", fontWeight: 900, fontSize: 12, borderRadius: 999, padding: "8px 16px" }}>
                  予約ページへ
                </button>
              </div>
            </div>
          ))}
          <p style={{ fontSize: 10, color: C.sub, lineHeight: 1.6, marginTop: 16 }}>
            ※掲載情報はサンプル(ダミー)です。※本アプリのシミュレーションは演出であり、実際の施術効果を保証するものではありません。
          </p>
        </main>
      )}

      {screen === "sim" && (
        <main style={{ padding: "0 16px 40px" }}>
          <button onClick={() => { stopCamera(); setScreen("home"); }} style={{ background: "none", border: "none", color: C.teal, fontWeight: 700, fontSize: 13, padding: "4px 0 12px" }}>
            ← ホームに戻る
          </button>

          {/* ---------- 画像エリア ---------- */}
          {!imgSrc && !cameraOn && (
            <div style={{ background: C.card, borderRadius: 20, padding: "36px 24px", textAlign: "center", border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 40 }}>😁</div>
              <div style={{ fontWeight: 900, fontSize: 16, margin: "8px 0 4px" }}>歯が見える笑顔の写真を用意</div>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 20 }}>明るい場所で、歯がはっきり写っているほど精度が上がります</div>
              <label style={{ display: "block", background: C.teal, color: "#fff", fontWeight: 900, borderRadius: 14, padding: "14px 0", fontSize: 14, marginBottom: 10, cursor: "pointer" }}>
                📷 写真をアップロード
                <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
              </label>
              <button onClick={startCamera} style={{ width: "100%", background: C.card, color: C.teal, fontWeight: 900, borderRadius: 14, padding: "13px 0", fontSize: 14, border: `2px solid ${C.teal}` }}>
                🤳 インカメラで撮影
              </button>
              {camError && <div style={{ fontSize: 12, color: "#B4452F", marginTop: 12 }}>{camError}</div>}
              {imgStatus && <div style={{ fontSize: 12, color: imgStatus === "読み込み中…" ? C.sub : "#B4452F", marginTop: 12, lineHeight: 1.6, textAlign: "left" }}>{imgStatus}</div>}
            </div>
          )}

          {cameraOn && (
            <div style={{ background: "#000", borderRadius: 20, overflow: "hidden", position: "relative" }}>
              <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block", transform: "scaleX(-1)" }} />
              <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 12 }}>
                <button onClick={capture} style={{ background: "#fff", border: "none", borderRadius: 999, width: 64, height: 64, fontSize: 24 }}>📸</button>
                <button onClick={stopCamera} style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: "1px solid #fff", borderRadius: 999, padding: "0 16px", fontWeight: 700 }}>閉じる</button>
              </div>
            </div>
          )}

          {imgSrc && (
            <>
              <div
                style={{ position: "relative", borderRadius: 20, overflow: "hidden", touchAction: "none", border: `1px solid ${C.line}` }}
                onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
              >
                <canvas ref={canvasRef} style={{ width: "100%", display: "block" }} />
                {editMode === "compare" && (
                  <>
                    <div style={{ position: "absolute", top: 10, left: 10, fontSize: 10, fontWeight: 900, background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 6, padding: "4px 8px" }}>BEFORE</div>
                    <div style={{ position: "absolute", top: 10, right: 10, fontSize: 10, fontWeight: 900, background: C.teal, color: "#fff", borderRadius: 6, padding: "4px 8px" }}>AFTER</div>
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: `${split * 100}%`, width: 0 }}>
                      <div style={{ position: "absolute", top: "50%", left: -16, width: 32, height: 32, borderRadius: 999, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, transform: "translateY(-50%)" }}>⇔</div>
                    </div>
                  </>
                )}
                {editMode === "area" && (
                  <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, fontSize: 11, fontWeight: 700, background: "rgba(14,133,120,0.9)", color: "#fff", borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
                    ① 緑の枠をタップ/ドラッグで口元に合わせてください
                  </div>
                )}
              </div>
              {editMode === "area" && (
                <div style={{ background: C.card, borderRadius: 16, padding: 16, marginTop: 10, border: `1px solid ${C.line}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>枠の大きさ</div>
                  <input
                    type="range" min="0.07" max="0.32" step="0.005"
                    value={mouth.r}
                    onChange={(e) => setMouth((prev) => ({ ...prev, r: Number(e.target.value) }))}
                    style={{ width: "100%", accentColor: C.teal }}
                  />
                  <button
                    onClick={() => setEditMode("compare")}
                    style={{ width: "100%", marginTop: 10, background: C.teal, border: "none", color: "#fff", fontWeight: 900, fontSize: 14, borderRadius: 12, padding: "13px 0" }}
                  >
                    ② この範囲でシミュレーション開始
                  </button>
                </div>
              )}
              {editMode === "compare" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <label style={{ fontSize: 12, color: C.teal, fontWeight: 700, cursor: "pointer" }}>
                    写真を変更
                    <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
                  </label>
                  <button onClick={() => setEditMode("area")} style={{ background: "none", border: `1.5px solid ${C.teal}`, color: C.teal, fontWeight: 700, fontSize: 11, borderRadius: 999, padding: "5px 12px" }}>
                    範囲を調整し直す
                  </button>
                  <span style={{ fontSize: 11, color: C.sub }}>スライダーで比較</span>
                </div>
              )}
              {imgStatus && <div style={{ fontSize: 12, color: "#B4452F", marginTop: 8, lineHeight: 1.6 }}>{imgStatus}</div>}

              {/* ---------- 方式 ---------- */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>ホワイトニングの方式</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {METHODS.map((mm) => (
                    <button key={mm.id} onClick={() => setMethod(mm.id)}
                      style={{
                        flex: 1, borderRadius: 14, padding: "10px 4px",
                        border: method === mm.id ? `2px solid ${C.teal}` : `1.5px solid ${C.line}`,
                        background: method === mm.id ? C.mint : C.card,
                      }}>
                      <div style={{ fontWeight: 900, fontSize: 13, color: method === mm.id ? C.tealDark : C.ink }}>{mm.label}</div>
                      <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{mm.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* ---------- 回数 ---------- */}
              <div style={{ marginTop: 16, background: C.card, borderRadius: 16, padding: 16, border: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>施術回数</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button onClick={() => setSessions(Math.max(1, sessions - 1))} style={{ width: 36, height: 36, borderRadius: 999, border: `1.5px solid ${C.line}`, background: C.card, fontSize: 18, fontWeight: 700 }}>−</button>
                    <span style={{ fontSize: 20, fontWeight: 900, minWidth: 44, textAlign: "center" }}>{sessions}回</span>
                    <button onClick={() => setSessions(Math.min(6, sessions + 1))} style={{ width: 36, height: 36, borderRadius: 999, border: "none", background: C.teal, color: "#fff", fontSize: 18, fontWeight: 700 }}>＋</button>
                  </div>
                </div>

                {/* ---------- シェードガイド ---------- */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>シェードガイド(色見本)の目安</div>
                  <div style={{ display: "flex", gap: 3 }}>
                    {SHADES.map((s, i) => (
                      <div key={s.name} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{
                          height: 34, borderRadius: 6, background: s.hex,
                          border: i === shadeIdx ? `3px solid ${C.teal}` : "3px solid transparent",
                          boxSizing: "border-box",
                        }} />
                        <div style={{ fontSize: 9, marginTop: 3, fontWeight: i === shadeIdx ? 900 : 400, color: i === shadeIdx ? C.tealDark : C.sub }}>{s.name}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 8, fontWeight: 700, color: C.tealDark }}>
                    {m.label}ホワイトニング {sessions}回で「{SHADES[shadeIdx].name}」相当の白さイメージ
                  </div>
                </div>
              </div>

              {/* ---------- CTA ---------- */}
              <button onClick={() => setScreen("home")}
                style={{ width: "100%", marginTop: 20, background: C.amber, border: "none", color: "#fff", fontWeight: 900, fontSize: 15, borderRadius: 16, padding: "16px 0", boxShadow: "0 6px 18px rgba(245,166,35,0.35)" }}>
                この白さにできるお店を探す →
              </button>

              <p style={{ fontSize: 10, color: C.sub, lineHeight: 1.6, marginTop: 14 }}>
                ※本シミュレーションは画像演出によるイメージであり、実際の施術効果・到達シェードを保証するものではありません。効果には個人差があります。※アップロードした画像は端末内でのみ処理され、サーバーには送信されません。
              </p>
            </>
          )}
        </main>
      )}
    </div>
  );
}
