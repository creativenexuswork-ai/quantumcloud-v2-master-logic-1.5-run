// Trade execution guard layer - crash-proof order building and execution

export interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  size?: number;
  mode?: string;
  price?: number;
}

export interface OrderResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  order?: {
    symbol: string;
    side: string;
    size: number;
    mode?: string;
    timestamp: number;
    price?: number;
  };
}

export interface ExecutionResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  fill?: {
    price: number;
    size: number;
    side: string;
    time: number;
  };
}

export function buildOrderRequest(params: OrderParams | null | undefined): OrderResult {
  try {
    if (!params) return { ok: false, reason: "NO_PARAMS" };
    const { symbol, side, size, mode } = params;

    if (!symbol) return { ok: false, reason: "NO_SYMBOL" };
    if (!side) return { ok: false, reason: "NO_SIDE" };

    const finalSize = size && size > 0 ? size : 0.001;

    return {
      ok: true,
      order: {
        symbol,
        side,
        size: finalSize,
        mode,
        timestamp: Date.now(),
      },
    };
  } catch (err: any) {
    return { ok: false, reason: "EXCEPTION", detail: err?.message };
  }
}

export async function executeOrder(orderPayload: OrderResult): Promise<ExecutionResult> {
  if (!orderPayload?.ok) {
    return { ok: false, reason: orderPayload?.reason ?? "INVALID_PAYLOAD" };
  }

  try {
    // In PAPER mode we simulate fills instantly
    return {
      ok: true,
      fill: {
        price: orderPayload.order?.price ?? 0,
        size: orderPayload.order?.size ?? 0.001,
        side: orderPayload.order?.side ?? 'BUY',
        time: Date.now(),
      },
    };
  } catch (e: any) {
    return { ok: false, reason: "EXEC_ERROR", detail: e?.message };
  }
}
