// Run in a browser console on a page whose Document-Policy enables js-profiling.
// See https://wicg.github.io/js-self-profiling/ for browser and policy requirements.
// Save the returned bare trace object (not an object wrapping it under "trace").
async function makeSelfProfile() {
  const profiler = new Profiler({sampleInterval: 10, maxBufferSize: 10000})
  await new Promise(resolve => setTimeout(resolve, 5000))
  const trace = await profiler.stop()
  return JSON.stringify(trace)
}
// Example: copy(await makeSelfProfile()) in browser developer tools, then save as JSON.
