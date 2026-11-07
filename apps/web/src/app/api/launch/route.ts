import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, LAUNCH_IP_LIMIT_MESSAGE, launchIpLimit, HOUR_MS, spendBudget } from '@/server/budget';
import { LaunchValidationError, runLaunch, type LaunchForm } from '@/server/launch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST multipart/form-data (name, ticker, description, website, twitter,
 * telegram, devBuyWei, image, wallet, walletNonce, walletSignature,
 * paymentSignature) → text/event-stream of the real launch
 * (see src/server/launch.ts for the frame protocol).
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!(await spendBudget(`launch:ip:${clientIp(req)}`, launchIpLimit(), HOUR_MS))) {
    return NextResponse.json({ error: LAUNCH_IP_LIMIT_MESSAGE }, { status: 429 });
  }
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }
  const image = fd.get('image');
  const form: Partial<LaunchForm> = {
    name: String(fd.get('name') ?? ''),
    ticker: String(fd.get('ticker') ?? '').toUpperCase(),
    description: String(fd.get('description') ?? ''),
    website: String(fd.get('website') ?? ''),
    twitter: String(fd.get('twitter') ?? ''),
    telegram: String(fd.get('telegram') ?? ''),
    halfLifePreset: String(fd.get('halfLifePreset') ?? ''),
    devBuyWei: String(fd.get('devBuyWei') ?? ''),
    wallet: String(fd.get('wallet') ?? ''),
    paymentSignature: String(fd.get('paymentSignature') ?? ''),
    walletNonce: String(fd.get('walletNonce') ?? ''),
    walletSignature: String(fd.get('walletSignature') ?? ''),
  };
  if (image instanceof Blob) form.image = { bytes: new Uint8Array(await image.arrayBuffer()), mime: image.type };
  const gen = runLaunch(form as LaunchForm);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`event: ${value.event}\ndata: ${value.data}\n\n`));
      } catch (e) {
        const message = e instanceof LaunchValidationError ? e.message : e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
        controller.close();
      }
    },
    cancel() {
      void gen.return(undefined);
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
}
