import localFont from "next/font/local";

// Syne — display / wordmark / section headers / primary sans
export const syne = localFont({
  src: [
    { path: "../app/fonts/Syne-400.ttf", weight: "400", style: "normal" },
    { path: "../app/fonts/Syne-500.ttf", weight: "500", style: "normal" },
    { path: "../app/fonts/Syne-600.ttf", weight: "600", style: "normal" },
    { path: "../app/fonts/Syne-700.ttf", weight: "700", style: "normal" },
    { path: "../app/fonts/Syne-800.ttf", weight: "800", style: "normal" },
  ],
  variable: "--font-syne",
  display: "swap",
});

// DM Mono — body / labels / UI / system copy
export const dmMono = localFont({
  src: [
    { path: "../app/fonts/DMMono-300.ttf", weight: "300", style: "normal" },
    {
      path: "../app/fonts/DMMono-300Italic.ttf",
      weight: "300",
      style: "italic",
    },
    { path: "../app/fonts/DMMono-400.ttf", weight: "400", style: "normal" },
    { path: "../app/fonts/DMMono-500.ttf", weight: "500", style: "normal" },
  ],
  variable: "--font-dm-mono",
  display: "swap",
});

// Cormorant Garamond — editorial / taglines (used sparingly per Ink rules)
export const cormorant = localFont({
  src: [
    {
      path: "../app/fonts/CormorantGaramond-300.ttf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../app/fonts/CormorantGaramond-300Italic.ttf",
      weight: "300",
      style: "italic",
    },
    {
      path: "../app/fonts/CormorantGaramond-400.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../app/fonts/CormorantGaramond-400Italic.ttf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../app/fonts/CormorantGaramond-500.ttf",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-cormorant",
  display: "swap",
});
