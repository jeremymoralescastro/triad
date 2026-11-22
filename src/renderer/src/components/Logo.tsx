/** The three-line mark, lines only. Drawn from the supplied icon's proportions. */
export function Logo() {
  return (
    <svg width="38" height="20" viewBox="0 0 360 186" fill="currentColor" role="img" aria-label="Triad" className="logo cursor-default overflow-visible">
      <rect className="logo-bar" style={{ ["--d" as string]: 0, ["--dir" as string]: 1 }} x="24" y="0" width="80" height="26" rx="13" />
      <rect className="logo-bar" style={{ ["--d" as string]: 1, ["--dir" as string]: -1 }} x="118" y="0" width="170" height="26" rx="13" />
      <rect className="logo-bar" style={{ ["--d" as string]: 2, ["--dir" as string]: 1 }} x="0" y="79" width="173" height="26" rx="13" />
      <rect className="logo-bar" style={{ ["--d" as string]: 3, ["--dir" as string]: -1 }} x="186" y="79" width="174" height="26" rx="13" />
      <rect className="logo-bar" style={{ ["--d" as string]: 4, ["--dir" as string]: 1 }} x="73" y="160" width="174" height="26" rx="13" />
      <rect className="logo-bar" style={{ ["--d" as string]: 5, ["--dir" as string]: -1 }} x="261" y="160" width="76" height="26" rx="13" />
    </svg>
  )
}
