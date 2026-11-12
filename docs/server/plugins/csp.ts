/**
 * Ginko's header middleware sets `content-security-policy: frame-ancestors 'self'` on every page,
 * which replaces the full policy from routeRules. This puts the rest of the policy back in front of
 * it, so Ginko stays the one source of frame-ancestors. Same pattern as lupinum-com.
 */
export default defineNitroPlugin((nitroApp) => {
  const { contentSecurityPolicy } = useRuntimeConfig();
  nitroApp.hooks.hook("beforeResponse", (event) => {
    const current = getResponseHeader(event, "content-security-policy");
    if (typeof current !== "string" || !/^frame-ancestors [^;]+$/.test(current)) return;
    setResponseHeader(event, "content-security-policy", `${contentSecurityPolicy}; ${current}`);
  });
});
