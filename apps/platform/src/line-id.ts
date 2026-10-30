// The owner's LINE id (D122): the LINE user id that LINE Login returns, U and 32 hex characters.
// BOOQ staff type it in P2 step 1; the owner invite is bound to it and compared exactly at sign in.
export const LINE_USER_ID = /^U[0-9a-f]{32}$/;
