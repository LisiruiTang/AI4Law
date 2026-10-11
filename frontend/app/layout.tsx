import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"AI4Law Simulator",description:"Token probabilities and branching tree simulator"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className="min-h-screen bg-[var(--background)] text-[var(--text)]">{children}</body></html>}
