"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="lost wrap">
      <div className="lost__copy" style={{ gridColumn: "1 / -1" }}>
        <h1 className="display t-xl">The board has gone dark.</h1>
        <p className="lede">We could not reach the Zenhyre server just now. Nothing you did was lost. Give it a moment and try again.</p>
        <button type="button" className="btn btn--ink" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
