
import { useState, useEffect } from 'react'
import { getConnectionString, getConnectionStringDescription, getAllClientTypes, maskConnectionString, type ClientType } from '../../utils/connectionStrings'
import { getSharedAgent } from '@db4app/client-sdk'
import './DbConnectionBox.css'

export function DbConnectionBox() {
    const [selectedClient, setSelectedClient] = useState<ClientType>('psql')
    const [copied, setCopied] = useState(false)
    const [connectionId, setConnectionId] = useState<string | null>(null)
    const [authToken, setAuthToken] = useState<string | null>(null)
    const [status, setStatus] = useState<string>('Initializing...')

    useEffect(() => {
        // Poll for shared agent status
        // Since we're mounted inside a disparate part of the page or even iframe, 
        // polling the singleton is a simple way to sync without complex context passing
        // or if we are outside the RelayProvider tree (though ideally we are inside).
        const checkAgent = () => {
            const agent = getSharedAgent()
            if (agent) {
                setConnectionId(agent.getConnectionId())
                setAuthToken(agent.getAuthToken())
                // We can't easily get status string back from agent yet without subscribing, 
                // but we know if connectionId is present, we are connected.
                if (agent.getConnectionId()) {
                    setStatus('Ready')
                } else {
                    setStatus('Connecting...')
                }
            } else {
                setStatus('Waiting for relay...')
            }
        }

        checkAgent()
        const interval = setInterval(checkAgent, 1000)
        return () => clearInterval(interval)
    }, [])

    const handleCopy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    // If no connection, show placeholder
    const effectiveConnectionId = connectionId
    // Fallback token for display if not connected yet
    const effectiveAuthToken = authToken || 'YOUR_AUTH_TOKEN'

    // Get connection string
    const clientConnectionString = getConnectionString({
        connectionId: effectiveConnectionId,
        authToken: effectiveAuthToken,
        clientType: selectedClient
    })

    // Create masked version
    const maskedConnectionString = maskConnectionString(clientConnectionString)
    const clientDescription = getConnectionStringDescription(selectedClient)

    return (
        <div className="db-connection-box">
            <div className="status-header">
                <span className="status-label">Browser engine</span>
                <strong>{status}</strong>
            </div>

            <div className="relay-bridge">
                <span className="status-label">Managed relay bridge</span>
                <strong>Connect External Tools</strong>

                <div className="client-selector">
                    <label htmlFor="mfe-client-selector">Select client:</label>
                    <select
                        id="mfe-client-selector"
                        value={selectedClient}
                        onChange={(e) => setSelectedClient(e.target.value as ClientType)}
                    >
                        {getAllClientTypes().map((client) => (
                            <option key={client} value={client}>
                                {client.charAt(0).toUpperCase() + client.slice(1)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="connection-string-container">
                    <code className="connection-string">
                        {maskedConnectionString}
                    </code>
                    <button
                        onClick={() => handleCopy(clientConnectionString)}
                        className={`copy-button ${copied ? 'copied' : ''}`}
                        title={copied ? 'Copied!' : 'Copy to clipboard'}
                    >
                        {copied ? '✓ Copied' : '📋 Copy'}
                    </button>
                </div>

                <span className="client-description">
                    <strong>{clientDescription}</strong>
                </span>
            </div>
        </div>
    )
}
