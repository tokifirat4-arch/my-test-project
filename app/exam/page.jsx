import dynamic from 'next/dynamic'
const ExamRoom = dynamic(() => import('@/components/ExamRoom'), { ssr: false })
export default function ExamPage() { return <ExamRoom /> }
