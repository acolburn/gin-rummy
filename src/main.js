import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Could not find #app element to mount the Svelte app");
}

const app = mount(App, {
  target,
});

export default app;
