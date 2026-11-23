import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const colors = ["#f783ff", "#a49cff", "#7ee8ff", "#87ffb5", "#ffda73", "#ff9765"];
const boardHeight = 44;
const sectionWidth = 28;
const socketWidth = 24;
const lead = 14;

export default function AgentCircuit({ connected, inputPulse }: { connected: boolean; inputPulse: number }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const pulseLayer = useRef<SVGGElement>(null);
  const previousPulse = useRef(inputPulse);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const id = useId();

  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const justPressed = previousPulse.current !== inputPulse;
    previousPulse.current = inputPulse;
    if (!connected || !justPressed || !pulseLayer.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const flash = pulseLayer.current.animate(
      [{ opacity: 0.25 }, { opacity: 0.95, offset: 0.16 }, { opacity: 0 }],
      { duration: 310, easing: "ease-out" },
    );
    return () => flash.cancel();
  }, [connected, inputPulse]);

  const { width, height } = size;
  const socket = width - socketWidth;
  const count = Math.max(0, Math.floor((socket - lead) / sectionWidth));
  const sections = Array.from({ length: count }, (_, index) => lead + index * sectionWidth);
  const board = `M0 2H12l5 5H${socket - 7}l7 3H${width}V34H${socket}l-7 3H17l-5 5H0Z`;
  const rise = (section: number) => section % 2 ? -3 : 3;
  const traces = colors.map((color, lane) => {
    const y = 10 + lane * 4.8;
    const stagger = lane % 3 * 2;
    const bends = sections.map((x, section) => {
      const dy = rise(section);
      return `H${x + stagger}l3 ${dy}h${8 + lane % 2 * 2}l3 ${-dy}`;
    }).join("");
    return { color, y, stagger, path: `M0 ${y}${bends}H${width - 3}` };
  });
  const style = {
    "--link-run": width,
    "--link-duration": `${width / 43}s`,
    "--link-steps": Math.max(1, Math.round(width / 2)),
  } as CSSProperties;

  return (
    <div aria-hidden="true" data-connected={connected} className="agent-circuit pointer-events-none absolute" ref={wrapper}>
      {width >= lead + socketWidth && (
        <svg className="h-full w-full overflow-visible" focusable="false" style={style}>
          <defs>
            <linearGradient id={`${id}-board`} x2="0" y2="1">
              <stop stopColor="#493327" />
              <stop offset=".23" stopColor="#2a2321" />
              <stop offset=".72" stopColor="#1a191a" />
              <stop offset="1" stopColor="#331f18" />
            </linearGradient>
            <linearGradient id={`${id}-socket`}>
              <stop stopColor="#786557" />
              <stop offset=".16" stopColor="#a19687" />
              <stop offset=".29" stopColor="#3c352f" />
              <stop offset=".77" stopColor="#2b2827" />
              <stop offset="1" stopColor="#504641" />
            </linearGradient>
            <pattern id={`${id}-vias`} width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".45" fill="#cbaa8a" opacity=".22" />
            </pattern>
          </defs>
          <g transform={`translate(0 ${(height - boardHeight) / 2})`}>
            <path className="circuit-board" d={board} fill={`url(#${id}-board)`} />
            <path d={board} fill={`url(#${id}-vias)`} />
            <path className="circuit-bevel" d={`M0 4h11l5 5H${socket - 7}M0 40h11l5 -5H${socket - 7}`} />
            <g className="circuit-traces">
              {traces.map(({ color, y, stagger, path }, lane) => (
                  <g key={color} color={color}>
                    <path className="circuit-trace" d={path} />
                    {sections.map((x, section) => (section + lane) % 3 === 0 && (
                      <circle key={x} className="circuit-via" cx={x + stagger + 8} cy={y + rise(section)} r="1.7" />
                    ))}
                    <path className="circuit-packet" d={path} pathLength={width} style={{ animationDelay: `${lane * -0.31}s` }} />
                  </g>
              ))}
            </g>
            <g className="circuit-input-pulse" ref={pulseLayer}>
              {traces.map(({ color, path }) => <path key={color} d={path} />)}
            </g>
            <g transform={`translate(${socket} 0)`}>
              <path d="M5 6h19v32H5l-5 -5V11Z" fill={`url(#${id}-socket)`} stroke="#161111" />
              <path d="M6 9h18M3 12v20m3 3h18" stroke="#e2be9760" fill="none" />
              {colors.map((color, lane) => (
                <path className="circuit-pin" key={color} d={`M0 ${10 + lane * 4.8}h12`} />
              ))}
            </g>
            <g className="circuit-sparks" shapeRendering="crispEdges">
              {[...sections.map((x) => x + 11), socket - 6].map((x, index) => (
                <g key={index} transform={`translate(${x} ${index % 2 ? 30 : 7})`}>
                  <path
                    className="circuit-spark"
                    style={{ animationDelay: `${index * -0.79}s`, animationDuration: `${2.4 + index % 4 * 0.37}s` }}
                    d="M-1 -4h2v3h3v2H1v3h-2V1h-3v-2h3ZM-6 -5h1v1H-6ZM5 3h1v1H5Z"
                  />
                  <rect className="circuit-ember" x="-0.5" y="-0.5" width="1" height="1" />
                </g>
              ))}
            </g>
          </g>
        </svg>
      )}
    </div>
  );
}
