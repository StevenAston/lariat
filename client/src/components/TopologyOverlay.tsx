import { useEffect, useState, RefObject } from 'react';
import { TopologyConnection } from '../TopologyPage';

interface TopologyOverlayProps {
  connections: TopologyConnection[];
  containerRef: RefObject<HTMLDivElement>;
}

interface PathData {
  d: string;
  status: 'linked' | 'broken';
  key: string;
}

export function TopologyOverlay({ connections, containerRef }: TopologyOverlayProps) {
  const [paths, setPaths] = useState<PathData[]>([]);

  useEffect(() => {
    const drawConnections = () => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const newPaths: PathData[] = [];
      
      connections.forEach(conn => {
        const fromEl = document.querySelector(`[data-node-id="${conn.fromId}"]`);
        const toEl = document.querySelector(`[data-node-id="${conn.toId}"]`);
        
        if (fromEl && toEl) {
          const fromRect = fromEl.getBoundingClientRect();
          const toRect = toEl.getBoundingClientRect();
          
          // Start point: middle right of the 'from' node
          const startX = (fromRect.right - containerRect.left) + containerRef.current!.scrollLeft;
          const startY = (fromRect.top + fromRect.height / 2 - containerRect.top) + containerRef.current!.scrollTop;
          
          // End point: middle left of the 'to' node
          const endX = (toRect.left - containerRect.left) + containerRef.current!.scrollLeft;
          const endY = (toRect.top + toRect.height / 2 - containerRect.top) + containerRef.current!.scrollTop;
          
          // Cubic Bezier curve
          const cp1x = startX + (endX - startX) / 2;
          const cp1y = startY;
          const cp2x = startX + (endX - startX) / 2;
          const cp2y = endY;
          
          const d = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
          
          newPaths.push({
            d,
            status: conn.status,
            key: `${conn.fromId}-${conn.toId}`
          });
        }
      });
      
      setPaths(newPaths);
    };

    // Draw on mount and when connections change
    // Using setTimeout to let DOM render nodes first
    const timer = setTimeout(drawConnections, 50);
    
    window.addEventListener('resize', drawConnections);
    // Add scroll listener if the container itself scrolls, but here we assume window resize is main trigger
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', drawConnections);
    };
  }, [connections, containerRef]);

  return (
    <svg 
      style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        width: '100%', 
        height: '100%', 
        pointerEvents: 'none',
        zIndex: 0
      }}
    >
      {paths.map(p => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          stroke={p.status === 'linked' ? 'var(--gray-7)' : 'var(--red-9)'}
          strokeWidth={p.status === 'linked' ? 2 : 3}
          strokeDasharray={p.status === 'broken' ? '5,5' : 'none'}
          className={p.status === 'linked' ? 'linked-path' : 'broken-path'}
        />
      ))}
    </svg>
  );
}
