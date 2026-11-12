// Website standard P-06: Plausible's own snippet, only when the production ID is set. A plugin, not
// app.vue, so error pages are counted too.
export default defineNuxtPlugin(() => {
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
});
