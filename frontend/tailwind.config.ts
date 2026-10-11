import type {Config} from "tailwindcss";
const config:Config={content:["./app/**/*.{js,ts,jsx,tsx,mdx}","./components/**/*.{js,ts,jsx,tsx,mdx}"],theme:{extend:{colors:{brand:{50:"#f0f4ff",100:"#e0e9ff",400:"#7b93fa",500:"#4f6ef7",600:"#3b5bdb",700:"#2f4ac5",900:"#1a2d7a"},accent:{DEFAULT:"#E0701A",hover:"#C85E14",muted:"#7a3d0e"}}}},plugins:[]};export default config;
