/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_CHAT_ENABLED?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
/** 빌드 때 `public/cosmetics` 내용 해시로 채워진다. 개발 서버·테스트에서는 정의되지 않는다. */
declare const __COSMETIC_ASSET_VERSION__: string | undefined;
