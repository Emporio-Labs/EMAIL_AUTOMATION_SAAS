import { ImageResponse } from "next/og";

export const alt = "SwayamMail: Email OTP, transactional and marketing email from one API";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#f7f6f1",
          color: "#1f1f1a",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 34, fontWeight: 600 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: "#1f1f1a",
              marginRight: 18,
              display: "flex",
            }}
          />
          SwayamMail
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5 }}>
            Email OTP, transactional and marketing email from one API.
          </div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#6f6f64" }}>
            Built for Indian businesses. Flat monthly plans in rupees, starting free.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#2c8b6b", fontWeight: 600 }}>
          swayammail.yugaas.in
        </div>
      </div>
    ),
    size,
  );
}
