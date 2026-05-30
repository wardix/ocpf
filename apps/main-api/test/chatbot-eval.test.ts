import { describe, it, expect } from 'bun:test';

// Safe condition evaluator function (extracted from index.ts for testing)
const safeEval = (condition: string, responseData: any): boolean => {
  let isSuccess = false;
  const match = condition.match(/response\.([\w\.]+)\s*(===|==|!==|!=|>|<|>=|<=)\s*(.+)/);
                      
  if (match) {
    const [_, path, operator, rawValue] = match;
    const value = path.split('.').reduce((acc: any, part: string) => acc && acc[part], responseData);
    
    let expectedValue: any = rawValue.trim();
    if ((expectedValue.startsWith("'") && expectedValue.endsWith("'")) || 
        (expectedValue.startsWith('"') && expectedValue.endsWith('"'))) {
      expectedValue = expectedValue.slice(1, -1);
    } else if (!isNaN(Number(expectedValue))) {
      expectedValue = Number(expectedValue);
    } else if (expectedValue === 'true') expectedValue = true;
    else if (expectedValue === 'false') expectedValue = false;
    else if (expectedValue === 'null') expectedValue = null;

    switch(operator) {
      case '==': isSuccess = value == expectedValue; break;
      case '===': isSuccess = value === expectedValue; break;
      case '!=': isSuccess = value != expectedValue; break;
      case '!==': isSuccess = value !== expectedValue; break;
      case '>': isSuccess = value > expectedValue; break;
      case '<': isSuccess = value < expectedValue; break;
      case '>=': isSuccess = value >= expectedValue; break;
      case '<=': isSuccess = value <= expectedValue; break;
    }
    return isSuccess;
  }
  return false;
};

describe('Security: Chatbot Engine Condition Evaluator', () => {
  const dummyResponse = {
    status: 'OK',
    data: {
      count: 5,
      is_active: true
    }
  };

  it('should evaluate legitimate simple conditions correctly', () => {
    expect(safeEval("response.status === 'OK'", dummyResponse)).toBe(true);
    expect(safeEval("response.data.count > 3", dummyResponse)).toBe(true);
    expect(safeEval("response.data.is_active == true", dummyResponse)).toBe(true);
    expect(safeEval("response.status !== 'FAIL'", dummyResponse)).toBe(true);
  });

  it('should safely reject RCE injection attempts without executing them', () => {
    // These would normally execute if new Function() was used
    expect(safeEval("process.exit(1)", dummyResponse)).toBe(false);
    expect(safeEval("require('fs').readFileSync('/etc/passwd')", dummyResponse)).toBe(false);
    
    // Injecting into the expected value side
    expect(safeEval("response.status === process.env.SECRET", dummyResponse)).toBe(false);
  });

  it('should return false for unsupported complex logic', () => {
    expect(safeEval("response.status === 'OK' && response.data.count > 0", dummyResponse)).toBe(false);
  });
});
