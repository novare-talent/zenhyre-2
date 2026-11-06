import { Archivo, DM_Mono } from "next/font/google";

// Archivo carries everything: its width axis gives the condensed display voice and the text voice.
export const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
// DM Mono is for machine strings only: roll numbers, tokens, emails, ledger references.
export const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
