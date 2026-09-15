import { theme } from "../theme";

/** The site's mark: a green disc with "Rs", and the name beside it. */
export const Logo = ({ size = 72, withName = true }: { size?: number; withName?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.3, fontFamily: theme.font }}>
    <div style={{ width: size, height: size, borderRadius: "50%", background: `linear-gradient(135deg, ${theme.green}, ${theme.greenDeep})`, display: "grid", placeItems: "center", color: "#062015", fontWeight: 700, fontSize: size * 0.42, letterSpacing: -1, boxShadow: `0 10px 40px rgba(61,220,151,0.35)` }}>
      Rs
    </div>
    {withName ? <div style={{ color: theme.text, fontWeight: 600, fontSize: size * 0.78, letterSpacing: -1.5 }}>PriceLens</div> : null}
  </div>
);
