import { LineageView } from '@/components/views/LineageView';
export const dynamic = 'force-dynamic';
export default function Page({ params }: { params: { id: string } }) { return <LineageView id={params.id} />; }
