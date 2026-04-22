import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Tournament from './pages/Tournament'
import Visualizer from './pages/Visualizer'
import ResetPassword from './pages/ResetPassword'

function PrivateRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { user } = useAuth()
  return !user ? children : <Navigate to="/" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/tournament/:id" element={<PrivateRoute><Visualizer /></PrivateRoute>} />
      <Route path="/share/:token" element={<Visualizer />} />
      <Route path="/hand-share/:handToken" element={<Visualizer />} />
      <Route path="/list-share/:listToken" element={<Visualizer />} />
      <Route path="/study/results" element={<PrivateRoute><Visualizer /></PrivateRoute>} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
