// PostHog analytics (US Cloud), shared by the Product Page and the app.
// Pageviews and autocaptured clicks are on by default; session recording also
// needs to be enabled in PostHog project settings. The phc_ project token is
// public by design (safe in browser code). Kept in a file, not inline, so the
// pages' Content-Security-Policy can forbid inline scripts.
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

// Member searches put ?member=<name> in the address bar so results can be
// shared. Remove it from every event's URLs (and replays' page addresses) before
// the event leaves the browser, so PostHog never stores what people searched for.
function scrubMember(value) {
  if (typeof value !== "string" || !value.includes("member=")) return value;
  try {
    const url = new URL(value);
    url.searchParams.delete("member");
    return url.href;
  } catch {
    return value.replace(/([?&])member=[^&#]*&?/g, "$1").replace(/[?&]$/, "");
  }
}
function scrubEvent(event) {
  if (!event) return event;
  for (const key of ["properties", "$set", "$set_once"]) {
    const props = event[key];
    if (props) for (const name of Object.keys(props)) props[name] = scrubMember(props[name]);
  }
  // Session replays record the page address inside "meta" entries (data.href).
  for (const entry of event.properties?.$snapshot_data || []) {
    if (entry?.data?.href) entry.data.href = scrubMember(entry.data.href);
  }
  return event;
}

posthog.init('phc_v9N7BjkJZcVr6dw8jJmxisTzkQdzmr5evBZwhhgEMRNv', {
  api_host: 'https://us.i.posthog.com',
  defaults: '2026-08-30',
  disable_session_recording: false,
  session_recording: { maskAllInputs: true }, // replays never show what people type
  before_send: scrubEvent,
});

// Custom click events without inline onclick handlers (blocked by the CSP):
// <a data-ph-event="event_name"> sends that event when clicked.
document.addEventListener("click", (event) => {
  const el = event.target.closest?.("[data-ph-event]");
  if (el) posthog.capture(el.dataset.phEvent);
});
