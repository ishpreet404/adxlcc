import React, { useState } from 'react';
import { Database, Search, AlertTriangle, Eye, Shield, Clock, Server } from 'lucide-react';
import { Card, Input, Button, StatusBadge, Separator } from '../components';

const APP_API_BASE_URL = (import.meta.env.VITE_APP_API_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
const BREACH_CHECK_ENDPOINT = `${APP_API_BASE_URL}/api/breach-check`;

const BreachChecker = () => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  // Field categorization
  const fieldTypes = {
    email: ['Email', 'email'],
    phone: ['Phone', 'Phone2', 'Phone3'],
    address: ['Address', 'City', 'State', 'Region', 'Country', 'PostCode', 'Zip'],
    sensitive: ['Password', 'CreditCard', 'CardExpiration', 'DocNumber', 'PassportNumber', 'IP', 'SSN', 'CVV'],
    personal: ['Name', 'FirstName', 'LastName', 'FullName', 'Username', 'Gender', 'Age', 'DOB', 'Birthday'],
    default: []
  };

  const getFieldType = (fieldName) => {
    for (const [type, fields] of Object.entries(fieldTypes)) {
      if (fields.some(f => fieldName.toLowerCase().includes(f.toLowerCase()))) {
        return type;
      }
    }
    return 'default';
  };

  const formatFieldName = (name) => {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .trim()
      .toUpperCase();
  };

  const checkBreaches = async () => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    setError(null);
    setResults(null);
    
    try {
      const payload = {
        query,
        limit: 100,
        lang: "en"
      };

      const response = await fetch(BREACH_CHECK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      
      if (!response.ok || data.error) {
        setError(`API Error: ${data.error || response.statusText || 'Please try again later'}`);
      } else {
        setResults(data);
      }
    } catch (err) {
      setError(`Connection Error: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-shadow-terminal mb-2">
          $ BREACH_CHECKER --SCAN=DATA
        </h1>
        <p className="text-terminal-muted">
          Search for exposed data in 15B+ breach records (email, phone, name)
        </p>
      </div>

      <Separator variant="equals" />

      {/* Search Section */}
      <Card title="▸ DATA EXPOSURE SCANNER">
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 border border-terminal-amber text-terminal-amber">
            <Eye className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">
              Your data is never stored. All searches are encrypted and anonymous.
            </div>
          </div>

          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && checkBreaches()}
            placeholder="email@example.com or phone number"
            prompt="query>"
            className="text-lg"
          />

          <Button 
            onClick={checkBreaches}
            disabled={!query || isSearching}
            className="w-full"
          >
            <div className="flex items-center justify-center gap-2">
              <Search className="w-4 h-4" />
              {isSearching ? 'SCANNING DATABASES...' : 'CHECK FOR BREACHES'}
            </div>
          </Button>
        </div>
      </Card>

      {/* Scanning Progress */}
      {isSearching && (
        <Card className="border-terminal-amber text-terminal-amber">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 animate-pulse" />
              <span>QUERYING LEAKOSINT DATABASE...</span>
            </div>
            <div className="text-xs space-y-1 text-terminal-muted">
              <div>{'[████████████████████]'} CHECKING 15B+ RECORDS</div>
              <div>{'[█████████████████░░░]'} ANALYZING DARK WEB DATA</div>
              <div>{'[███████████████████░]'} CROSS-REFERENCING LEAKS</div>
            </div>
            <div className="text-xs flex items-center gap-2">
              <span className="cursor"></span>
              <span>Searching for: {query}</span>
            </div>
          </div>
        </Card>
      )}

      {/* Error Display */}
      {error && !isSearching && (
        <Card className="border-terminal-red">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-8 h-8 text-terminal-red" />
              <div>
                <div className="text-xl font-bold text-terminal-red">[CONNECTION ERROR]</div>
                <div className="text-terminal-muted">{error}</div>
              </div>
            </div>
            <Button onClick={checkBreaches} className="w-full">
              RETRY SEARCH
            </Button>
          </div>
        </Card>
      )}

      {/* Results */}
      {results && !isSearching && !error && (
        <>
          {/* No Results Found */}
          {(!results.List || results.NumOfResults === 0) && (
            <Card title="▸ SCAN COMPLETE" className="border-terminal-green">
              <div className="flex items-center gap-4">
                <Shield className="w-12 h-12 text-terminal-green" />
                <div>
                  <div className="text-3xl font-bold text-terminal-green">NO DATA FOUND</div>
                  <div className="text-terminal-muted">No breached data was found for: {query}</div>
                </div>
              </div>
              <div className="mt-4 p-3 border border-terminal-green">
                <StatusBadge status="ok">EXCELLENT NEWS</StatusBadge>
                <div className="mt-2 text-sm">
                  This query did not appear in our breach database. However, continue practicing good security hygiene.
                </div>
              </div>
            </Card>
          )}

          {/* Results Found */}
          {results.List && results.NumOfResults > 0 && (
            <>
              {/* Statistics Header */}
              <Card title="▸ SCAN RESULTS" className="border-terminal-red">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 border border-terminal-red">
                    <Database className="w-6 h-6 mx-auto mb-2 text-terminal-red" />
                    <div className="text-2xl font-bold text-terminal-red">{results.NumOfDatabase}</div>
                    <div className="text-xs text-terminal-muted">DATABASES</div>
                  </div>
                  <div className="text-center p-3 border border-terminal-red">
                    <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-terminal-red" />
                    <div className="text-2xl font-bold text-terminal-red">{results.NumOfResults}</div>
                    <div className="text-xs text-terminal-muted">RECORDS FOUND</div>
                  </div>
                  <div className="text-center p-3 border border-terminal-green">
                    <Clock className="w-6 h-6 mx-auto mb-2 text-terminal-green" />
                    <div className="text-2xl font-bold text-terminal-green">{results['search time']?.toFixed(3)}s</div>
                    <div className="text-xs text-terminal-muted">SEARCH TIME</div>
                  </div>
                  <div className="text-center p-3 border border-terminal-green">
                    <Server className="w-6 h-6 mx-auto mb-2 text-terminal-green" />
                    <div className="text-2xl font-bold text-terminal-green">{results.free_requests_left}</div>
                    <div className="text-xs text-terminal-muted">REQUESTS LEFT</div>
                  </div>
                </div>

                <div className="mt-4 p-3 border border-terminal-red text-terminal-red">
                  <StatusBadge status="error">CRITICAL - DATA EXPOSED</StatusBadge>
                  <div className="mt-2 text-sm">
                    Your information was found in {results.NumOfDatabase} breach database{results.NumOfDatabase > 1 ? 's' : ''}.
                    Review all exposed data below and take immediate action.
                  </div>
                </div>
              </Card>

              {/* Database Results */}
              <div className="space-y-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <span>DATABASE RECORDS:</span>
                  <span className="text-terminal-red">({results.NumOfResults} total)</span>
                </h2>

                {Object.entries(results.List).map(([dbName, dbData]) => (
                  <Card key={dbName} className="border-terminal-red">
                    <div className="space-y-4">
                      {/* Database Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-xl font-bold text-terminal-red flex items-center gap-2">
                            <Database className="w-5 h-5" />
                            🔓 {dbName}
                          </div>
                          {dbData.InfoLeak && (
                            <div className="mt-2 text-sm text-terminal-amber flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <span>{dbData.InfoLeak}</span>
                            </div>
                          )}
                        </div>
                        <div className="px-3 py-1 border border-terminal-red text-terminal-red text-sm">
                          {dbData.NumOfResults} RECORD{dbData.NumOfResults > 1 ? 'S' : ''}
                        </div>
                      </div>

                      <Separator variant="dots" />

                      {/* Data Entries */}
                      {dbData.Data && dbData.Data.map((entry, entryIdx) => (
                        <div key={entryIdx} className="border border-terminal-muted p-3">
                          <div className="text-sm font-bold mb-3 text-terminal-amber">
                            [RECORD #{entryIdx + 1}]
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {Object.entries(entry).map(([fieldName, fieldValue]) => {
                              if (!fieldValue || fieldValue === 'null') return null;
                              
                              const fieldType = getFieldType(fieldName);
                              const fieldClass = 
                                fieldType === 'sensitive' ? 'text-terminal-red' :
                                fieldType === 'email' ? 'text-terminal-amber' :
                                fieldType === 'phone' ? 'text-terminal-amber' :
                                'text-terminal-green';

                              return (
                                <div key={fieldName} className="space-y-1">
                                  <div className="text-xs text-terminal-muted">
                                    {formatFieldName(fieldName)}:
                                  </div>
                                  <div className={`text-sm font-mono ${fieldClass} break-all`}>
                                    {fieldValue}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              {/* Recommendations */}
              <Card title="▸ IMMEDIATE ACTIONS REQUIRED" className="border-terminal-amber">
                <div className="space-y-3 text-terminal-amber">
                  <div className="flex items-start gap-3">
                    <span className="text-terminal-red font-bold">1.</span>
                    <span>Change passwords immediately on all affected accounts</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-terminal-red font-bold">2.</span>
                    <span>Enable 2FA (Two-Factor Authentication) everywhere possible</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-terminal-red font-bold">3.</span>
                    <span>Use unique passwords for each service (use a password manager)</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-terminal-red font-bold">4.</span>
                    <span>Monitor accounts for suspicious activity</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-terminal-red font-bold">5.</span>
                    <span>If credit card info was exposed, contact your bank immediately</span>
                  </div>

                  <Separator variant="dots" />

                  <div className="flex gap-2">
                    <Button onClick={() => setResults(null)} className="flex-1">
                      NEW SEARCH
                    </Button>
                    <Button variant="warning" onClick={() => window.print()}>
                      PRINT REPORT
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          )}
        </>
      )}

      {/* Info Section */}
      <Card title="▸ HOW IT WORKS">
        <div className="space-y-4 text-sm">
          <div>
            <div className="font-bold mb-1">$ COMPREHENSIVE DATABASE</div>
            <div className="text-terminal-muted">
              We scan 15+ billion records from known data breaches, including dark web dumps and leaked databases.
            </div>
          </div>
          <Separator variant="dots" />
          <div>
            <div className="font-bold mb-1">$ PRIVACY FIRST</div>
            <div className="text-terminal-muted">
              Your email is hashed before searching. We never store or log your searches.
            </div>
          </div>
          <Separator variant="dots" />
          <div>
            <div className="font-bold mb-1">$ CONTINUOUS MONITORING</div>
            <div className="text-terminal-muted">
              Enable alerts to be notified immediately when your email appears in new breaches.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default BreachChecker;
