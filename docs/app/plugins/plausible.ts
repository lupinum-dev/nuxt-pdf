// Website standard P-06: Plausible's own snippet, only when the production ID is set. A plugin, not
// app.vue, so error pages are counted too.
export default defineNuxtPlugin((nuxtApp) => {
  const { plausibleScriptId } = useRuntimeConfig().public;
  if (!plausibleScriptId) return;

  useHead({
    script: [
      { src: `https://plausible.io/js/pa-${plausibleScriptId}.js`, async: true },
      {
        innerHTML:
          "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()",
      },
    ],
  });

  // The "404" goal in Plausible: which addresses readers reach that do not exist (old links, typos).
  if (import.meta.client) {
    const error = useError();
    nuxtApp.hook("app:mounted", () => {
      watch(
        () => error.value && "statusCode" in error.value && error.value.statusCode,
        (status) => {
          if (status === 404) window.plausible?.("404", { props: { path: location.pathname } });
        },
        { immediate: true },
      );
    });
  }
});

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
  }
}
