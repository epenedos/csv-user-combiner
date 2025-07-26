import React, { useState, useCallback } from 'react';
import { Upload, FileText, Users, AlertTriangle, Download } from 'lucide-react';
import Papa from 'papaparse';

const CSVUserCombiner = () => {
  const [files, setFiles] = useState([]);
  const [combinedData, setCombinedData] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [showCombinedCSV, setShowCombinedCSV] = useState(false);
  const [showDuplicatesCSV, setShowDuplicatesCSV] = useState(false);

  const handleFileUpload = useCallback((event) => {
    const uploadedFiles = Array.from(event.target.files);
    setFiles(uploadedFiles);
    setCombinedData([]);
    setDuplicates([]);
    setResults(null);
  }, []);

  const copyToClipboard = (type) => {
    const csv = type === 'combined' ? 
      Papa.unparse(combinedData) : 
      Papa.unparse(
        duplicates.flatMap(group => 
          group.records.map(record => ({
            duplicate_name: group.originalName || group.duplicateValue,
            duplicate_type: 'Name',
            ...record
          }))
        )
      );
    
    navigator.clipboard.writeText(csv).then(() => {
      alert(`${type === 'combined' ? 'Combined' : 'Duplicate'} CSV data copied to clipboard!`);
    }).catch(() => {
      alert('Could not copy to clipboard. Try the "Show CSV" option below.');
    });
  };

  const processFiles = async () => {
    if (files.length === 0) return;

    setProcessing(true);
    let allUsers = [];
    let fileResults = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: (result) => {
              if (result.errors.length > 0) {
                console.warn(`Errors in ${file.name}:`, result.errors);
              }
              
              // Find the Type field (case insensitive)
              const typeField = Object.keys(result.data.length > 0 ? result.data[0] : {}).find(key => 
                key.toLowerCase() === 'type'
              );
              
              // Define the specific fields to extract
              const requiredFields = ['Type', 'Display Name', 'Name', 'Domain'];
              
              const filteredData = result.data
                .filter(row => {
                  // If no Type field exists, include all records
                  if (!typeField) return true;
                  return String(row[typeField]).toLowerCase() === 'user';
                })
                .map(row => {
                  // Extract only the required fields (case insensitive matching)
                  const extractedData = {};
                  
                  requiredFields.forEach(field => {
                    // Find the actual field name in the data (case insensitive)
                    const actualFieldName = Object.keys(row).find(key => 
                      key.toLowerCase() === field.toLowerCase()
                    );
                    
                    if (actualFieldName) {
                      extractedData[field] = row[actualFieldName];
                    } else {
                      extractedData[field] = ''; // Empty if field not found
                    }
                  });
                  
                  // Add metadata
                  extractedData.__source_file = file.name;
                  extractedData.__file_index = i;
                  
                  return extractedData;
                });
              
              allUsers = allUsers.concat(filteredData);
              
              // Check which required fields are available in this file
              const availableFields = requiredFields.filter(field =>
                Object.keys(result.data.length > 0 ? result.data[0] : {}).some(key => 
                  key.toLowerCase() === field.toLowerCase()
                )
              );
              
              fileResults.push({
                fileName: file.name,
                totalRowCount: result.data.length,
                userRowCount: filteredData.length,
                hasTypeField: !!typeField,
                availableFields: availableFields,
                missingFields: requiredFields.filter(field => !availableFields.includes(field)),
                columns: result.meta.fields || []
              });
              
              resolve();
            },
            error: reject
          });
        });
      }

      // Check if Name field is available for duplicate detection
      const hasNameField = allUsers.length > 0 && allUsers.some(record => record['Name']);

      // Find duplicates based on Name field only
      const duplicateGroups = findDuplicates(allUsers);
      
      setCombinedData(allUsers);
      setDuplicates(duplicateGroups);
      setResults({
        totalRecords: allUsers.length,
        totalFiles: files.length,
        fileDetails: fileResults,
        hasNameField: hasNameField,
        duplicateCount: duplicateGroups.reduce((sum, group) => sum + group.records.length, 0),
        duplicateGroups: duplicateGroups.length,
        totalOriginalRecords: fileResults.reduce((sum, file) => sum + file.totalRowCount, 0)
      });

    } catch (error) {
      console.error('Error processing files:', error);
    } finally {
      setProcessing(false);
    }
  };

  const findDuplicates = (data) => {
    const duplicateGroups = [];
    
    // Use the "Name" field for duplicate detection
    const nameField = 'Name';
    
    if (!data.some(record => record[nameField])) {
      console.warn('No "Name" field found in the processed data');
      return [];
    }

    const nameMap = new Map();
    
    data.forEach((record, index) => {
      const nameValue = record[nameField];
      if (nameValue && String(nameValue).trim() !== '') {
        const normalizedName = String(nameValue).toLowerCase().trim();
        
        if (!nameMap.has(normalizedName)) {
          nameMap.set(normalizedName, []);
        }
        nameMap.get(normalizedName).push({ ...record, __original_index: index });
      }
    });

    // Find groups with more than one record (duplicates)
    nameMap.forEach((records, nameValue) => {
      if (records.length > 1) {
        duplicateGroups.push({
          strategy: 'Name',
          duplicateValue: nameValue,
          records: records,
          originalName: records[0][nameField] // Keep original formatting
        });
      }
    });

    return duplicateGroups;
  };

  const downloadCombinedData = () => {
    const csv = Papa.unparse(combinedData);
    
    try {
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = 'combined_users.csv';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      navigator.clipboard.writeText(csv).then(() => {
        alert('CSV data copied to clipboard! Paste it into a text file and save as .csv');
      }).catch(() => {
        const newWindow = window.open();
        newWindow.document.write('<pre>' + csv + '</pre>');
        newWindow.document.title = 'Combined Users CSV - Copy and Save';
      });
    }
  };

  const downloadDuplicates = () => {
    const duplicateRecords = duplicates.flatMap(group => 
      group.records.map(record => ({
        duplicate_name: group.originalName || group.duplicateValue,
        duplicate_type: 'Name',
        ...record
      }))
    );
    
    const csv = Papa.unparse(duplicateRecords);
    
    try {
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = 'duplicate_names.csv';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      navigator.clipboard.writeText(csv).then(() => {
        alert('Duplicate names CSV data copied to clipboard! Paste it into a text file and save as .csv');
      }).catch(() => {
        const newWindow = window.open();
        newWindow.document.write('<pre>' + csv + '</pre>');
        newWindow.document.title = 'Duplicate Names CSV - Copy and Save';
      });
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          CSV User Data Combiner & Duplicate Detector
        </h1>
        <p className="text-gray-600">
          Upload multiple CSV files containing user data to combine them and identify duplicates based on the "Name" field.
          <span className="font-medium text-blue-600"> Only records with Type = "User" will be processed (if Type field exists).</span>
          <br />
          <span className="font-medium text-purple-600">Only these fields will be extracted: Type, Display Name, Name, Domain</span>
        </p>
      </div>

      {/* File Upload */}
      <div className="mb-8">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <div className="mb-4">
            <label className="cursor-pointer">
              <span className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors">
                Choose CSV Files
              </span>
              <input
                type="file"
                multiple
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-sm text-gray-500">Select multiple CSV files to process</p>
        </div>
        
        {files.length > 0 && (
          <div className="mt-4">
            <h3 className="font-medium text-gray-900 mb-2">Selected Files:</h3>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div key={index} className="flex items-center text-sm text-gray-600">
                  <FileText className="h-4 w-4 mr-2" />
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </div>
              ))}
            </div>
            <button
              onClick={processFiles}
              disabled={processing}
              className="mt-4 bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 disabled:bg-gray-400 transition-colors"
            >
              {processing ? 'Processing...' : 'Process Files'}
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-blue-900 mb-4 flex items-center">
              <Users className="h-5 w-5 mr-2" />
              Processing Summary
            </h2>
            
            <div className="mb-4">
              {results.hasNameField ? (
                <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">
                  ✓ Using "Name" field for duplicate detection
                </div>
              ) : (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  ⚠ No "Name" field found - duplicate detection disabled
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <div className="font-medium text-blue-900">User Records</div>
                <div className="text-2xl font-bold text-blue-600">{results.totalRecords}</div>
              </div>
              <div>
                <div className="font-medium text-blue-900">Total Records</div>
                <div className="text-lg font-medium text-gray-600">{results.totalOriginalRecords}</div>
              </div>
              <div>
                <div className="font-medium text-blue-900">Files Processed</div>
                <div className="text-2xl font-bold text-blue-600">{results.totalFiles}</div>
              </div>
              <div>
                <div className="font-medium text-blue-900">Duplicate Records</div>
                <div className="text-2xl font-bold text-red-600">{results.duplicateCount}</div>
              </div>
              <div>
                <div className="font-medium text-blue-900">Duplicate Groups</div>
                <div className="text-2xl font-bold text-red-600">{results.duplicateGroups}</div>
              </div>
            </div>
            
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={downloadCombinedData}
                className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors flex items-center"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Combined Data
              </button>
              <button
                onClick={() => copyToClipboard('combined')}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Copy Combined CSV
              </button>
              <button
                onClick={() => setShowCombinedCSV(!showCombinedCSV)}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                {showCombinedCSV ? 'Hide' : 'Show'} Combined CSV
              </button>
              {duplicates.length > 0 && (
                <>
                  <button
                    onClick={downloadDuplicates}
                    className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors flex items-center"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Name Duplicates
                  </button>
                  <button
                    onClick={() => copyToClipboard('duplicates')}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Copy Duplicates CSV
                  </button>
                  <button
                    onClick={() => setShowDuplicatesCSV(!showDuplicatesCSV)}
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    {showDuplicatesCSV ? 'Hide' : 'Show'} Duplicates CSV
                  </button>
                </>
              )}
            </div>
          </div>
          
          {/* CSV Content Display */}
          {showCombinedCSV && (
            <div className="mt-4 bg-gray-50 border border-gray-300 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-2">Combined CSV Data (copy and save as .csv file):</h4>
              <textarea
                value={Papa.unparse(combinedData)}
                readOnly
                className="w-full h-40 text-xs font-mono border border-gray-300 rounded p-2 resize-vertical"
                onClick={(e) => e.target.select()}
              />
            </div>
          )}
          
          {showDuplicatesCSV && duplicates.length > 0 && (
            <div className="mt-4 bg-gray-50 border border-gray-300 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-2">Duplicates CSV Data (copy and save as .csv file):</h4>
              <textarea
                value={Papa.unparse(
                  duplicates.flatMap(group => 
                    group.records.map(record => ({
                      duplicate_name: group.originalName || group.duplicateValue,
                      duplicate_type: 'Name',
                      ...record
                    }))
                  )
                )}
                readOnly
                className="w-full h-40 text-xs font-mono border border-gray-300 rounded p-2 resize-vertical"
                onClick={(e) => e.target.select()}
              />
            </div>
          )}

          {/* File Details */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">File Details</h3>
            <div className="space-y-3">
              {results.fileDetails.map((file, index) => (
                <div key={index} className="bg-white p-4 rounded border">
                  <div className="font-medium text-gray-900">{file.fileName}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {file.hasTypeField ? (
                      <>
                        {file.userRowCount} user records (out of {file.totalRowCount} total)
                        {file.userRowCount < file.totalRowCount && (
                          <span className="text-blue-600 ml-1">
                            • {file.totalRowCount - file.userRowCount} non-user records filtered out
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {file.userRowCount} records (no "Type" field found - all records included)
                      </>
                    )}
                    <br />
                    <span className="text-green-600">Found fields: {file.availableFields.join(', ')}</span>
                    {file.missingFields.length > 0 && (
                      <>
                        <br />
                        <span className="text-red-600">Missing fields: {file.missingFields.join(', ')}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Duplicates */}
          {duplicates.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-red-900 mb-4 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Name Duplicates Found
              </h3>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {duplicates.map((group, index) => (
                  <div key={index} className="bg-white p-4 rounded border border-red-200">
                    <div className="font-medium text-red-900 mb-2">
                      Name Duplicate: "{group.originalName || group.duplicateValue}"
                    </div>
                    <div className="text-sm text-gray-600 mb-3">
                      {group.records.length} records found with the same name
                    </div>
                    <div className="space-y-2">
                      {group.records.map((record, recordIndex) => (
                        <div key={recordIndex} className="text-xs bg-gray-50 p-2 rounded">
                          <span className="font-medium">From: {record.__source_file}</span>
                          <div className="mt-1">
                            {Object.entries(record)
                              .filter(([key]) => !key.startsWith('__'))
                              .slice(0, 5)
                              .map(([key, value]) => (
                                <span key={key} className="mr-3">
                                  <strong>{key}:</strong> {String(value)}
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Preview */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Data Preview (First 10 Records)</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    {combinedData.length > 0 && Object.keys(combinedData[0])
                      .filter(key => !key.startsWith('__'))
                      .map(key => (
                        <th key={key} className="px-2 py-1 text-left font-medium text-gray-700 border">
                          {key}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {combinedData.slice(0, 10).map((record, index) => (
                    <tr key={index} className="border-t">
                      {Object.entries(record)
                        .filter(([key]) => !key.startsWith('__'))
                        .map(([key, value], cellIndex) => (
                          <td key={cellIndex} className="px-2 py-1 border text-gray-600">
                            {String(value)}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CSVUserCombiner;