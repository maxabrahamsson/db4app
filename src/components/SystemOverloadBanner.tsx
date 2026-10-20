import { useState, useEffect } from 'react'
import { useRelay } from '../contexts/RelayContext'
import './SystemOverloadBanner.css'

const RETRY_DELAY_SECONDS = 300 // 5 minutes

export function SystemOverloadBanner() {
    const { relayError } = useRelay()
    const [timeLeft, setTimeLeft] = useState(RETRY_DELAY_SECONDS)

    useEffect(() => {
        if (relayError !== 'capacity_limit') {
            setTimeLeft(RETRY_DELAY_SECONDS)
            return
        }

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer)
                    // Auto-refresh the page when timer hits zero
                    window.location.reload()
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(timer)
    }, [relayError])

    if (relayError !== 'capacity_limit') {
        return null
    }

    const minutes = Math.floor(timeLeft / 60)
    const seconds = timeLeft % 60
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`

    return (
        <div className="system-overload-banner">
            <div className="system-overload-content">
                <span className="system-overload-icon">⚠️</span>
                <div className="system-overload-text">
                    <strong>System Overloaded</strong>
                    <p>We are experiencing exceptionally high traffic. To ensure stability, we are limiting new connections.</p>
                </div>
                <div className="system-overload-action">
                    <p>Auto-retrying in {formattedTime}</p>
                    <button
                        className="system-overload-button"
                        onClick={() => window.location.reload()}
                    >
                        Retry Now
                    </button>
                </div>
            </div>
        </div>
    )
}
