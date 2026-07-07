# ハミュレーション (hamulation)

歯のホワイトニング・シミュレーターアプリ。写真から白い歯をシミュレーションし、地域の歯科医院・サロンへ送客する。

## 技術
- React 18 + Vite
- 追加ライブラリなし(canvasによる画像処理はブラウザ標準APIのみ)

## ローカルで動かす場合(任意)
```
npm install
npm run dev
```

## Vercelデプロイ設定
- Framework Preset: **Vite**
- Build Command: `npm run build`
- Output Directory: `dist`
- (Vercelが自動検出するので、通常は変更不要)
