import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET;
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;

interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

/**
 * Create a signed JWT token with 24-hour expiry.
 */
export function createToken(username: string): string {
  if (!JWT_SECRET) {
    throw new Error("[Auth] JWT_SECRET environment variable is not set");
  }

  return jwt.sign({ username }, JWT_SECRET, {
    expiresIn: "24h",
  });
}

/**
 * Verify the JWT from the 'auth_token' cookie on an incoming request.
 * Returns true if the token is valid, false otherwise.
 */
export async function verifyAuth(request: NextRequest): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error("[Auth] JWT_SECRET environment variable is not set");
    return false;
  }

  try {
    const token = request.cookies.get("auth_token")?.value;

    if (!token) {
      return false;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // Ensure the token contains a valid username
    if (!decoded.username || typeof decoded.username !== "string") {
      return false;
    }

    return true;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      console.warn("[Auth] Token expired");
    } else if (err instanceof jwt.JsonWebTokenError) {
      console.warn("[Auth] Invalid token:", (err as Error).message);
    } else {
      console.error("[Auth] Verification error:", err);
    }
    return false;
  }
}

/**
 * Verify username/password credentials against environment variables.
 */
export function verifyCredentials(
  username: string,
  password: string
): boolean {
  if (!AUTH_USERNAME || !AUTH_PASSWORD) {
    console.error(
      "[Auth] AUTH_USERNAME or AUTH_PASSWORD environment variables are not set"
    );
    return false;
  }

  return username === AUTH_USERNAME && password === AUTH_PASSWORD;
}
