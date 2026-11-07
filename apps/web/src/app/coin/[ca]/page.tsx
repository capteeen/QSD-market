import { CoinView } from '@/components/views/CoinView';
export const dynamic = 'force-dynamic';
export default function Page({ params }: { params: { ca: string } }) { return <CoinView ca={params.ca} />; }
