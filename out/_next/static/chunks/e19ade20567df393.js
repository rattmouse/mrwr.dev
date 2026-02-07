(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,20268,e=>{e.v("/_next/static/media/ms_sans_serif.d44a0ad2.woff2")},49e3,e=>{e.v("/_next/static/media/ms_sans_serif_bold.354d1ba6.woff2")},18566,(e,t,o)=>{t.exports=e.r(76562)},60998,e=>{"use strict";var t=e.i(43476),o=e.i(71645),a=e.i(18566),i=e.i(97053);function r({children:e}){let[r]=(0,o.useState)(()=>new i.ServerStyleSheet);return(0,a.useServerInsertedHTML)(()=>{let e=r.getStyleElement();return r.instance.clearTag(),(0,t.jsx)(t.Fragment,{children:e})}),(0,t.jsx)(t.Fragment,{children:e})}e.s(["default",()=>r])},88805,(e,t,o)=>{"use strict";t.exports={name:"original",anchor:"#1034a6",anchorVisited:"#440381",borderDark:"#848584",borderDarkest:"#0a0a0a",borderLight:"#dfdfdf",borderLightest:"#fefefe",canvas:"#ffffff",canvasText:"#0a0a0a",canvasTextDisabled:"#848584",canvasTextDisabledShadow:"#fefefe",canvasTextInvert:"#fefefe",checkmark:"#0a0a0a",checkmarkDisabled:"#848584",desktopBackground:"#008080",flatDark:"#9e9e9e",flatLight:"#d8d8d8",focusSecondary:"#fefe03",headerBackground:"#060084",headerNotActiveBackground:"#7f787f",headerNotActiveText:"#c6c6c6",headerText:"#fefefe",hoverBackground:"#060084",material:"#c6c6c6",materialDark:"#9a9e9c",materialText:"#0a0a0a",materialTextDisabled:"#848584",materialTextDisabledShadow:"#fefefe",materialTextInvert:"#fefefe",progress:"#060084",tooltip:"#fefbcc"}},36977,e=>{"use strict";var t=e.i(43476),o=e.i(97053);e.i(85672);var a=e.i(39460),a=a,i=e.i(88805),r=e.i(20268),n=e.i(49e3);let s=o.createGlobalStyle`
  ${a.default}

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${r.default}') format('woff2');
    font-weight: 400;
    font-style: normal;
  }

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('${n.default}') format('woff2');
    font-weight: bold;
    font-style: normal;
  }

  /* --- Window control icons (Storybook-style helpers) --- */
  .minimize-icon,
  .maximize-icon,
  .close-icon {
    display: inline-block;
    width: 12px;
    height: 12px;
    position: relative;
    pointer-events: none; /* clicks should hit the Button */
  }

  .minimize-icon::after {
    content: "";
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 2px;
    height: 2px;
    background: #000;
  }

  .maximize-icon::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 2px;
    right: 2px;
    bottom: 2px;
    border: 2px solid #000;
    box-sizing: border-box;
  }

  .close-icon::before,
  .close-icon::after {
    content: "";
    position: absolute;
    left: 5px;
    top: 1px;
    width: 2px;
    height: 10px;
    background: #000;
    transform-origin: center;
  }
  .close-icon::before { transform: rotate(45deg); }
  .close-icon::after  { transform: rotate(-45deg); }

  html, body {
    height: 100%;
  }

  body {
    font-family: 'ms_sans_serif';
    font-size: 12px;              /* big one: keeps spacing/menu right */
    line-height: 1.2;

    background: #008080; /* classic teal */

    /* helps avoid “modern smooth” look */
    -webkit-font-smoothing: none;
    -moz-osx-font-smoothing: auto;
    text-rendering: optimizeSpeed;
  }

  textarea {
    resize: none;
  }

`;function f({children:e}){return(0,t.jsxs)(o.ThemeProvider,{theme:i.default,children:[(0,t.jsx)(s,{}),e]})}e.s(["default",()=>f],36977)}]);