declare module "*.woff";
declare module "*.woff2";
declare module "*.ttf";
declare module "*.otf";

declare module "@strudel/web" {
  export function initStrudel(options?: unknown): Promise<unknown>;
}

declare module "@strudel/codemirror";
