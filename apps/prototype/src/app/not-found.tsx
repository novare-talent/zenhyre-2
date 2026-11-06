import type { Metadata } from "next";
import Link from "next/link";
import { Bar } from "@/components/Bar";
import { Board } from "@/components/Board";
import { Arrow } from "@/components/Icons";

export const metadata: Metadata = { title: "No such page", description: "There is no twenty-fourth campus, and no page at this address. Head back to the board." };

export default function NotFound() {
  return (
    <>
      <Bar />
      <main id="main" tabIndex={-1} className="lost wrap">
        <div className="grid12 lost__grid">
          <div className="lost__copy">
            <h1 className="display t-xl">There is no twenty&#8209;fourth campus.</h1>
            <p className="lede">The board has twenty-three cells and this page is not one of them. The address may be mistyped, or the role may have been withdrawn.</p>
            <Link href="/" className="btn btn--ink">Back to the board<Arrow /></Link>
          </div>
          <div className="lost__board">
            <Board selected={new Set()} compact label="The board: 23 campuses and one empty cell" voidCell />
          </div>
        </div>
      </main>
    </>
  );
}
