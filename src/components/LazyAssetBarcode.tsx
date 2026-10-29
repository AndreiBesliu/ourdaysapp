// src/components/LazyAssetBarcode.tsx
//
// AssetBarcode, loaded the first time a code is shown (29.10.2026). The event window draws a linked
// card's code, and the card next to a checklist row, and it sits in the chunk everybody loads at
// boot; the two code libraries it pulled in did too, for the few times a day somebody opens one.
//
// While the chunk loads, a quiet placeholder of about the code's height. If it cannot load at all —
// no signal at the till and not fetched before, or a tab older than a deploy — the card's NUMBER is
// shown, as for a code that cannot be drawn: it can still be read out or typed in, and the line under
// it says a reload brings the code back. The failure is reported (ErrorBoundary; a stale tab as
// 'StaleChunk'), and the rest of the window keeps working. The app fetches the chunk while idle
// (App.tsx), so this is the rare case, not the first visit.
//
// A failed load is not kept (review of 29.10.2026): React.lazy keeps a rejection for good, so the
// lazy is replaced when its load fails, and the next time the window opens the chunk is asked for
// again. Where the browser itself keeps the failed fetch until a reload, the line under the number
// is what helps.
//
// The Wallet screen and the offline Cards page import AssetBarcode directly: the first is already a
// chunk of its own, and the second is a separate build that must work with nothing fetched.

import { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';
import type AssetBarcode from './AssetBarcode';
import CodeNumber from './CodeNumber';
import ErrorBoundary from './ErrorBoundary';
import { loadAssetBarcode } from '../utils/lazyParts';

type Props = ComponentProps<typeof AssetBarcode>;
/** What `import('./AssetBarcode')` brings. */
type CodeModule = { default: ComponentType<Props> };
interface LoadCode { (): Promise<CodeModule> }

const PLACEHOLDER = { lg: 'min-h-[120px]', md: 'min-h-[100px]', sm: 'min-h-[64px]' } as const;

/** A code drawn by whatever `load` brings, with the placeholder and the number around it. */
export function lazyCode(load: LoadCode) {
  const retrying: LoadCode = () => load().catch((e: unknown) => { Code = lazy(retrying); throw e; });
  let Code = lazy(retrying);
  return function LazyCode(props: Props) {
    const size = props.size ?? 'lg';
    return (
      <ErrorBoundary
        context="LazyAssetBarcode"
        fallback={<CodeNumber value={props.value} size={size} reason="walletCodeNotLoaded" language={props.language} />}
      >
        <Suspense fallback={<div className={`w-full ${PLACEHOLDER[size]} flex items-center justify-center`} aria-busy="true">
          <div className="w-5 h-5 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
        </div>}>
          <Code {...props} />
        </Suspense>
      </ErrorBoundary>
    );
  };
}

export default lazyCode(loadAssetBarcode);
