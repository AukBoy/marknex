import React from 'react';

// Simple line chart using SVG (no external dependencies)
function SimpleLineChart({ data, title, xAxisLabel, yAxisLabel, height = 300 }) {
    if (!data || data.length < 2) return null;

    const width = 500;
    const padding = { top: 40, right: 20, bottom: 60, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Find max value for scaling
    const maxValue = Math.max(...data.map(d => d.value));
    const minValue = Math.min(...data.map(d => d.value));
    const range = maxValue - minValue || 1;
    const yScale = chartHeight / range;
    const xSpacing = chartWidth / (data.length - 1 || 1);

    // Generate path for line
    const pathData = data
        .map((d, i) => {
            const x = padding.left + i * xSpacing;
            const y = height - padding.bottom - ((d.value - minValue) * yScale);
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        })
        .join(' ');

    return (
        <div style={{ padding: '1.5rem', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
            {title && <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>{title}</h3>}
            <div style={{ overflowX: 'auto' }}>
                <svg width={width} height={height} style={{ minWidth: '100%' }}>
                    {/* Grid lines */}
                    {[0.25, 0.5, 0.75, 1].map(ratio => (
                        <line
                            key={`grid-${ratio}`}
                            x1={padding.left}
                            y1={padding.top + chartHeight - (chartHeight * ratio)}
                            x2={width - padding.right}
                            y2={padding.top + chartHeight - (chartHeight * ratio)}
                            stroke="var(--border)"
                            strokeDasharray="4"
                            opacity={0.5}
                        />
                    ))}

                    {/* Y-axis */}
                    <line
                        x1={padding.left}
                        y1={padding.top}
                        x2={padding.left}
                        y2={height - padding.bottom}
                        stroke="var(--text-muted)"
                        strokeWidth={2}
                    />

                    {/* X-axis */}
                    <line
                        x1={padding.left}
                        y1={height - padding.bottom}
                        x2={width - padding.right}
                        y2={height - padding.bottom}
                        stroke="var(--text-muted)"
                        strokeWidth={2}
                    />

                    {/* Y-axis labels */}
                    {[0.25, 0.5, 0.75, 1].map(ratio => (
                        <g key={`label-${ratio}`}>
                            <text
                                x={padding.left - 10}
                                y={padding.top + chartHeight - (chartHeight * ratio) + 4}
                                textAnchor="end"
                                fontSize={12}
                                fill="var(--text-muted)"
                            >
                                {Math.round(minValue + range * ratio)}
                            </text>
                        </g>
                    ))}

                    {/* Line path */}
                    <path d={pathData} stroke="var(--primary)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />

                    {/* Area under the line (fill) */}
                    <path
                        d={`${pathData} L ${width - padding.right} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`}
                        fill="var(--primary)"
                        opacity={0.1}
                    />

                    {/* Data points */}
                    {data.map((d, i) => {
                        const x = padding.left + i * xSpacing;
                        const y = height - padding.bottom - ((d.value - minValue) * yScale);

                        return (
                            <g key={`point-${i}`}>
                                <circle cx={x} cy={y} r={4} fill="var(--primary)" />
                                <circle cx={x} cy={y} r={2} fill="white" />
                                <text
                                    x={x}
                                    y={height - padding.bottom + 20}
                                    textAnchor="middle"
                                    fontSize={12}
                                    fill="var(--text-muted)"
                                >
                                    {d.label}
                                </text>
                            </g>
                        );
                    })}

                    {/* Axis labels */}
                    {xAxisLabel && (
                        <text x={width / 2} y={height - 5} textAnchor="middle" fontSize={12} fill="var(--text-muted)">
                            {xAxisLabel}
                        </text>
                    )}
                    {yAxisLabel && (
                        <text
                            x={-height / 2}
                            y={15}
                            textAnchor="middle"
                            fontSize={12}
                            fill="var(--text-muted)"
                            transform="rotate(-90)"
                        >
                            {yAxisLabel}
                        </text>
                    )}
                </svg>
            </div>
        </div>
    );
}

export default SimpleLineChart;
