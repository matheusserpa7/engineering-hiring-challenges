// Plain TypeScript, which type-aware ESLint uses, cannot read .vue files. vue-tsc can, and
// it uses the real component types instead of this declaration.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
