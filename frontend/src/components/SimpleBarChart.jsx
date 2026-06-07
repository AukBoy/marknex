import React from 'react';

// Simple bar chart using SVG (no external dependencies)
function SimpleBarChart({ data, title, xAxisLabel, yAxisLabel, height = 300 }) {
    if (!data || data.length === 0) return null;

    const width = 500;
    const padding = { top: 40, right: 20, bottom: 60, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Find max value for scaling
    const maxValue = Math.max(...data.map(d => d.value));
    const yScale = chartHeight / (maxValue || 1);
    const barWidth = chartWidth / (data.length || 1) * 0.7;
    const barSpacing = chartWidth / (data.length || 1);

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
                                {Math.round(maxValue * ratio)}
                            </text>
                        </g>
                    ))}

                    {/* Bars */}
                    {data.map((d, i) => {
                        const x = padding.left + (i * barSpacing) + (barSpacing - barWidth) / 2;
                        const barHeight = (d.value / maxValue) * chartHeight || 0;
                        const y = height - padding.bottom - barHeight;

                        return (
                            <g key={`bar-${i}`}>
                                <rect
                                    x={x}
                                    y={y}
                                    width={barWidth}
                                    height={barHeight}
                                    fill={d.color || 'var(--primary)'}
                                    opacity={0.8}
                                    rx={4}
                                />
                                <text
                                    x={x + barWidth / 2}
                                    y={height - padding.bottom + 20}
                                    textAnchor="middle"
                                    fontSize={12}
                                    fill="var(--text-muted)"
                                >
                                    {d.label}
                                </text>
                                <text
                                    x={x + barWidth / 2}
                                    y={y - 5}
                                    textAnchor="middle"
                                    fontSize={11}
                                    fontWeight="600"
                                    fill="var(--text-main)"
                                >
                                    {d.value}
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

export default SimpleBarChart;
