import { useState, useEffect, useRef, useCallback } from "react";
import { renderMermaidSvg } from "../utils/mermaidConfig";

export interface MermaidCanvasProps {
  content: string;
  active?: boolean;
  className?: string;
  showZoomControls?: boolean;
}

const WHEEL_ZOOM_INTENSITY = 0.002;
const BUTTON_ZOOM_FACTOR = 1.2;
const MIN_SCALE = 1e-4;
const WHEEL_SMOOTH_MS = 120;

function formatZoomLabel(scale: number): string {
  const pct = scale * 100;
  if (pct >= 10000 || pct < 0.1) return `${scale.toFixed(2)}×`;
  if (pct >= 1000) return `${Math.round(pct)}%`;
  return `${Math.round(pct)}%`;
}

export function MermaidCanvas({
  content,
  active = true,
  className = "",
  showZoomControls = true,
}: MermaidCanvasProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isWheeling, setIsWheeling] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPosition, setLastPosition] = useState({ x: 0, y: 0 });
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const fullScreenScaleRef = useRef<number>(1);
  const wheelSmoothTimerRef = useRef<number | null>(null);

  const applyZoomAtPoint = useCallback(
    (factor: number, centerX: number, centerY: number) => {
      if (factor <= 0 || !Number.isFinite(factor)) return;
      setScale((prevScale) => {
        const nextScale = Math.max(MIN_SCALE, prevScale * factor);
        const appliedFactor = nextScale / prevScale;
        setPosition((prevPos) => ({
          x: prevPos.x - centerX * (appliedFactor - 1),
          y: prevPos.y - centerY * (appliedFactor - 1),
        }));
        return nextScale;
      });
    },
    []
  );

  const markWheeling = useCallback(() => {
    setIsWheeling(true);
    if (wheelSmoothTimerRef.current !== null) {
      window.clearTimeout(wheelSmoothTimerRef.current);
    }
    wheelSmoothTimerRef.current = window.setTimeout(() => {
      setIsWheeling(false);
      wheelSmoothTimerRef.current = null;
    }, WHEEL_SMOOTH_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (wheelSmoothTimerRef.current !== null) {
        window.clearTimeout(wheelSmoothTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    setPosition({ x: 0, y: 0 });
    setLastPosition({ x: 0, y: 0 });
  }, [active, content]);

  useEffect(() => {
    if (!active || !diagramRef.current || !containerRef.current) return;

    const renderDiagram = async () => {
      setIsRendering(true);
      setRenderError(null);

      try {
        diagramRef.current!.innerHTML = "";
        const svg = await renderMermaidSvg(content);
        diagramRef.current!.innerHTML = svg;

        requestAnimationFrame(() => {
          if (!diagramRef.current || !containerRef.current) return;

          const svgElement = diagramRef.current.querySelector("svg");
          if (!svgElement) return;

          const containerRect = containerRef.current.getBoundingClientRect();
          const padding = 32;
          const availableWidth = containerRect.width - padding;
          const availableHeight = containerRect.height - padding;

          let svgWidth = svgElement.getBoundingClientRect().width;
          let svgHeight = svgElement.getBoundingClientRect().height;

          if ((!svgWidth || svgWidth === 0) && svgElement.viewBox?.baseVal) {
            svgWidth = svgElement.viewBox.baseVal.width;
            svgHeight = svgElement.viewBox.baseVal.height;
          }

          if ((!svgWidth || svgWidth === 0) && svgElement.hasAttribute("width")) {
            svgWidth = parseFloat(svgElement.getAttribute("width") || "800");
            svgHeight = parseFloat(svgElement.getAttribute("height") || "600");
          }

          if (!svgWidth || svgWidth === 0) {
            svgWidth = 800;
            svgHeight = 600;
          }

          const scaleX = availableWidth / svgWidth;
          const scaleY = availableHeight / svgHeight;
          const fitScale = Math.max(MIN_SCALE, Math.min(scaleX, scaleY));
          fullScreenScaleRef.current = fitScale;
          setScale(fitScale);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Mermaid rendering error:", error);
        setRenderError(message);
        fullScreenScaleRef.current = 1;
        setScale(1);
      } finally {
        setIsRendering(false);
      }
    };

    renderDiagram();
  }, [active, content, retryCount]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !active) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      markWheeling();

      const rect = container.getBoundingClientRect();
      const centerX = e.clientX - rect.left - rect.width / 2;
      const centerY = e.clientY - rect.top - rect.height / 2;

      // Scroll/pinch up (negative deltaY) zooms in — same as expand modal
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_INTENSITY);
      applyZoomAtPoint(factor, centerX, centerY);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [active, applyZoomAtPoint, markWheeling]);

  const handleZoomIn = () => applyZoomAtPoint(BUTTON_ZOOM_FACTOR, 0, 0);
  const handleZoomOut = () => applyZoomAtPoint(1 / BUTTON_ZOOM_FACTOR, 0, 0);

  const handleReset = () => {
    setScale(fullScreenScaleRef.current);
    setPosition({ x: 0, y: 0 });
    setLastPosition({ x: 0, y: 0 });
  };

  const stopDrag = () => setIsDragging(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (renderError) return;
    if (e.target === diagramRef.current || diagramRef.current?.contains(e.target as Node)) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPosition(position);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: lastPosition.x + (e.clientX - dragStart.x),
        y: lastPosition.y + (e.clientY - dragStart.y),
      });
    }
  };

  const transformTransition =
    isDragging || isWheeling ? "none" : "transform 0.18s cubic-bezier(0.25, 0.1, 0.25, 1)";

  return (
    <div className={`relative flex flex-col flex-1 min-h-0 ${className}`}>
      {showZoomControls && (
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-2 bg-slack-bgHover hover:bg-slack-accent text-slack-text hover:text-white rounded transition-colors"
            title="Zoom In"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-2 bg-slack-bgHover hover:bg-slack-accent text-slack-text hover:text-white rounded transition-colors"
            title="Zoom Out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="p-2 bg-slack-bgHover hover:bg-slack-accent text-slack-text hover:text-white rounded transition-colors"
            title="Reset View"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      )}

      {renderError ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-lg p-4 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
            <strong>Mermaid Diagram Error:</strong>
            <pre className="mt-2 text-xs whitespace-pre-wrap">{renderError}</pre>
            <button
              type="button"
              className="mt-3 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded text-xs transition-colors"
              onClick={() => setRetryCount((prev) => prev + 1)}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative flex-1 min-h-0 overflow-hidden cursor-grab active:cursor-grabbing flex items-center justify-center"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
        >
          {isRendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
              <div className="flex items-center gap-2 text-slack-text">
                <div className="w-5 h-5 border-2 border-slack-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Rendering diagram...</span>
              </div>
            </div>
          )}
          <div
            ref={diagramRef}
            className="p-4 bg-white rounded border border-slack-border flex items-center justify-center"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: "center center",
              transition: transformTransition,
            }}
          />
        </div>
      )}

      {showZoomControls && !renderError && (
        <div className="absolute bottom-4 left-4 z-10 px-3 py-1 bg-slack-bgHover text-slack-text rounded text-sm">
          {formatZoomLabel(scale)}
        </div>
      )}
    </div>
  );
}
